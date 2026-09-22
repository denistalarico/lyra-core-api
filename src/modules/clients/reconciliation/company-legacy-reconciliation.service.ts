import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { AgencyClientCompanyContext } from '../entities';
import { CompanyContextReconciliationAudit } from '../entities/company-context-reconciliation-audit.entity';
import type { CompanyLegacyDomain } from './company-legacy-domains';
import {
  COMPANY_LEGACY_DOMAINS,
  findCompanyLegacyDomain,
} from './company-legacy-domains';

const AGENCY_CONNECTION = 'agency';

/** Hard cap so a huge legacy backlog can never be pulled in one request. */
const MAX_PAGE_SIZE = 100;

export type CompanyLegacyCandidate = {
  companyContextId: string;
  displayName: string;
};

/**
 * `requires_manual_research` is not a stored state — the row stays
 * `legacy_unassigned`. It is a UI hint meaning "this row carries no evidence
 * of which commercial account it belongs to", so an operator must research it
 * before CC2G can accept an assignment.
 */
export type CompanyLegacyResolution = 'assignable' | 'requires_manual_research';

export type CompanyLegacyRow = {
  domainKey: string;
  rowId: string;
  agencyClientId: string | null;
  title: string | null;
  createdAt: string | null;
  summary: Record<string, unknown>;
  possibleCompanies: CompanyLegacyCandidate[];
  /** Populated only by NOT NULL, already-company-scoped parents. */
  automaticCandidate: CompanyLegacyCandidate | null;
  resolution: CompanyLegacyResolution;
};

export type CompanyLegacyFilters = {
  agencyClientId?: string;
  domainKey?: string;
  product?: string;
};

export type CompanyLegacySummary = {
  total: number;
  domains: Array<{
    domainKey: string;
    label: string;
    product: string;
    count: number;
  }>;
};

export type CompanyLegacyAssignment = {
  domainKey: string;
  rowId: string;
  companyContextId: string;
  agencyClientId: string;
  auditId: string;
};

/**
 * CC2G — inventory and reconciliation of `legacy_unassigned` roots.
 *
 * This service is the single place that knows how to *read* and *mutate* the
 * legacy scope columns; the per-domain specifics come from
 * `COMPANY_LEGACY_DOMAINS`. It is an Agency/admin boundary only: nothing here
 * is reachable from company mode, so legacy counts and ids never leak into a
 * company-scoped session.
 *
 * Ownership is never inferred. The only automatic evidence accepted is a
 * mandatory persisted parent that is already company-scoped — never
 * `isPrimary`, names, owners, contacts, branding, metadata or creation dates.
 */
@Injectable()
export class CompanyLegacyReconciliationService {
  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
  ) {}

  listDomains(): readonly CompanyLegacyDomain[] {
    return COMPANY_LEGACY_DOMAINS;
  }

  /**
   * Per-domain counts. Domains with zero legacy rows are omitted so the admin
   * screen shows work to do rather than a wall of empty boundaries.
   */
  async summary(
    ctx: RequestContext,
    filters: CompanyLegacyFilters = {},
  ): Promise<CompanyLegacySummary> {
    const domains = this.selectDomains(filters);
    const counted = await Promise.all(
      domains.map(async (domain) => ({
        domainKey: domain.domainKey,
        label: domain.label,
        product: domain.product,
        count: await this.count(ctx, domain, filters),
      })),
    );
    const domainsWithWork = counted.filter((entry) => entry.count > 0);

    return {
      total: domainsWithWork.reduce((sum, entry) => sum + entry.count, 0),
      domains: domainsWithWork,
    };
  }

  async list(
    ctx: RequestContext,
    filters: CompanyLegacyFilters = {},
    pagination: { limit?: number; offset?: number } = {},
  ): Promise<{ rows: CompanyLegacyRow[]; total: number }> {
    const domains = this.selectDomains(filters);
    const limit = Math.min(
      Math.max(Number(pagination.limit) || 25, 1),
      MAX_PAGE_SIZE,
    );
    const offset = Math.max(Number(pagination.offset) || 0, 0);

    // Counts drive both the total and the page window across domains, so the
    // list can page through several boundaries without a UNION over ~22
    // differently-shaped tables.
    const counts = await Promise.all(
      domains.map((domain) => this.count(ctx, domain, filters)),
    );
    const total = counts.reduce((sum, value) => sum + value, 0);

    const rows: CompanyLegacyRow[] = [];
    let cursor = offset;
    for (const [index, domain] of domains.entries()) {
      if (rows.length >= limit) break;
      const domainCount = counts[index];
      if (cursor >= domainCount) {
        cursor -= domainCount;
        continue;
      }
      const page = await this.selectRows(ctx, domain, filters, {
        limit: limit - rows.length,
        offset: cursor,
      });
      cursor = 0;
      rows.push(...(await this.project(ctx, domain, page)));
    }

    return { rows, total };
  }

  async get(
    ctx: RequestContext,
    domainKey: string,
    rowId: string,
  ): Promise<CompanyLegacyRow> {
    const domain = this.requireDomain(domainKey);
    const [raw] = await this.selectRows(ctx, domain, {}, { rowId });
    if (!raw) throw new NotFoundException('Legacy row not found.');
    const [projected] = await this.project(ctx, domain, [raw]);
    return projected;
  }

  /**
   * Assigns one legacy root to a Company Context, transactionally, and writes
   * the audit record in the same transaction.
   *
   * The row is re-read `FOR UPDATE` inside the transaction, so two admins
   * acting on the same row serialize: the first wins and the second sees the
   * row is no longer legacy and gets a 409 rather than a silent overwrite.
   * This endpoint never moves a row between companies.
   */
  async assign(
    ctx: RequestContext,
    domainKey: string,
    rowId: string,
    input: { companyContextId: string; reason: string },
  ): Promise<CompanyLegacyAssignment> {
    const domain = this.requireDomain(domainKey);
    const reason = input.reason?.trim();
    if (!reason) {
      throw new BadRequestException('A reason is required.');
    }
    if (!input.companyContextId) {
      throw new BadRequestException('A company context is required.');
    }
    const actorUserId = ctx.userId;
    if (!actorUserId) {
      throw new BadRequestException('An authenticated actor is required.');
    }

    return this.dataSource.transaction(async (manager) => {
      const locked = await this.lockRow(manager, ctx, domain, rowId);
      if (!locked) {
        throw new NotFoundException('Legacy row not found.');
      }
      if (!this.isLegacy(domain, locked)) {
        // Someone else reconciled it first. Idempotent-by-conflict: we never
        // rewrite an assignment that already exists.
        throw new ConflictException(
          'This row is no longer pending: it was already assigned to a company.',
        );
      }

      const company = await this.loadCompanyContext(
        manager,
        ctx,
        input.companyContextId,
      );

      // A row that already carries a client may only be assigned to a company
      // of that same client. A `scope_kind` row carries none, so the company's
      // own client becomes the row's client.
      const rowClientId = (locked.agency_client_id as string | null) ?? null;
      if (rowClientId && rowClientId !== company.agencyClientId) {
        throw new BadRequestException(
          'The company context does not belong to this row commercial account.',
        );
      }

      // A persisted parent outranks the operator: assigning against it would
      // create exactly the cross-company parent/child CC2G must prevent.
      await this.assertParentCompatible(manager, ctx, domain, locked, company);

      await this.writeAssignment(manager, domain, rowId, company);

      const audit = await manager.getRepository(
        CompanyContextReconciliationAudit,
      ).save(
        manager.getRepository(CompanyContextReconciliationAudit).create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          domainKey: domain.domainKey,
          rowId,
          agencyClientId: company.agencyClientId,
          previousCompanyContextId: null,
          assignedCompanyContextId: company.id,
          actorUserId,
          reason,
          evidence: {
            scopeEncoding: domain.scopeEncoding,
            previousScope: {
              agencyClientId: rowClientId,
              companyContextId: null,
              ...(domain.scopeEncoding === 'column'
                ? { scopeKind: 'legacy_unassigned' }
                : {}),
            },
          },
        }),
      );

      return {
        domainKey: domain.domainKey,
        rowId,
        companyContextId: company.id,
        agencyClientId: company.agencyClientId,
        auditId: audit.id,
      };
    });
  }

  // ── Reading ───────────────────────────────────────────────────────────

  private selectDomains(
    filters: CompanyLegacyFilters,
  ): readonly CompanyLegacyDomain[] {
    let domains = COMPANY_LEGACY_DOMAINS;
    if (filters.domainKey) {
      domains = domains.filter(
        (domain) => domain.domainKey === filters.domainKey,
      );
    }
    if (filters.product) {
      domains = domains.filter((domain) => domain.product === filters.product);
    }
    return domains;
  }

  private requireDomain(domainKey: string): CompanyLegacyDomain {
    const domain = findCompanyLegacyDomain(domainKey);
    if (!domain) throw new NotFoundException('Unknown reconciliation domain.');
    return domain;
  }

  /**
   * The legacy predicate, expressed once. See `company-legacy-domains.ts` for
   * why the two encodings differ.
   */
  private legacyPredicate(domain: CompanyLegacyDomain): string {
    return domain.scopeEncoding === 'column'
      ? `legacy_row."scope_kind" = 'legacy_unassigned'`
      : `legacy_row."agency_client_id" IS NOT NULL AND legacy_row."company_context_id" IS NULL`;
  }

  private baseConditions(
    domain: CompanyLegacyDomain,
    filters: CompanyLegacyFilters,
  ): { sql: string; params: Record<string, unknown> } {
    const clauses = [
      `legacy_row."tenant_id" = :tenantId`,
      `legacy_row."workspace_id" = :workspaceId`,
      this.legacyPredicate(domain),
    ];
    const params: Record<string, unknown> = {};

    if (domain.softDeleteColumn) {
      clauses.push(`legacy_row."${domain.softDeleteColumn}" IS NULL`);
    }
    if (filters.agencyClientId) {
      // A `scope_kind` legacy row has no client, so a client filter can only
      // ever match the encodings that kept one.
      if (domain.scopeEncoding === 'column') {
        clauses.push('FALSE');
      } else {
        clauses.push(`legacy_row."agency_client_id" = :agencyClientId`);
        params.agencyClientId = filters.agencyClientId;
      }
    }

    return { sql: clauses.join(' AND '), params };
  }

  private async count(
    ctx: RequestContext,
    domain: CompanyLegacyDomain,
    filters: CompanyLegacyFilters,
  ): Promise<number> {
    const { sql, params } = this.baseConditions(domain, filters);
    const [result] = await this.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "${domain.table}" legacy_row WHERE ${sql}`,
      { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, ...params },
    );
    return Number(result?.count ?? 0);
  }

  /**
   * Projects only the registry-approved columns. Because the column list is a
   * closed allowlist declared per domain, a secret, token or message body can
   * never reach the admin API by accident.
   */
  private selectRows(
    ctx: RequestContext,
    domain: CompanyLegacyDomain,
    filters: CompanyLegacyFilters,
    page: { limit?: number; offset?: number; rowId?: string },
  ): Promise<Array<Record<string, unknown>>> {
    const { sql, params } = this.baseConditions(domain, filters);
    const projected = new Set<string>([
      ...(domain.titleColumn ? [domain.titleColumn] : []),
      ...domain.summaryColumns,
      ...(domain.parentEvidence ? [domain.parentEvidence.column] : []),
    ]);
    const timestampColumn = domain.timestampColumn ?? 'created_at';
    const columns = [
      'legacy_row."id" AS id',
      `legacy_row."${timestampColumn}" AS created_at`,
      domain.scopeEncoding === 'column'
        ? 'NULL::uuid AS agency_client_id'
        : 'legacy_row."agency_client_id" AS agency_client_id',
      ...[...projected].map((column) => `legacy_row."${column}" AS "${column}"`),
    ].join(', ');

    const where = page.rowId ? `${sql} AND legacy_row."id" = :rowId` : sql;
    const window = page.rowId
      ? ''
      : ` ORDER BY legacy_row."${timestampColumn}" ASC, legacy_row."id" ASC LIMIT ${Number(page.limit) || 25} OFFSET ${Number(page.offset) || 0}`;

    return this.query(
      `SELECT ${columns} FROM "${domain.table}" legacy_row WHERE ${where}${window}`,
      {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        ...params,
        ...(page.rowId ? { rowId: page.rowId } : {}),
      },
    );
  }

  private async project(
    ctx: RequestContext,
    domain: CompanyLegacyDomain,
    raws: Array<Record<string, unknown>>,
  ): Promise<CompanyLegacyRow[]> {
    if (raws.length === 0) return [];

    const parentScopes = await this.loadParentScopes(ctx, domain, raws);
    const clientIds = new Set<string>();
    for (const raw of raws) {
      const rowClient = raw.agency_client_id as string | null;
      if (rowClient) clientIds.add(rowClient);
      const parent = parentScopes.get(String(raw.id));
      if (parent?.agencyClientId) clientIds.add(parent.agencyClientId);
    }
    const candidatesByClient = await this.loadCandidates(ctx, [...clientIds]);

    return raws.map((raw) => {
      const rowId = String(raw.id);
      const parent = parentScopes.get(rowId) ?? null;
      const agencyClientId =
        (raw.agency_client_id as string | null) ?? parent?.agencyClientId ?? null;

      const summary: Record<string, unknown> = {};
      for (const column of domain.summaryColumns) {
        summary[column] = this.serialize(raw[column]);
      }

      // A NOT NULL, already-company-scoped parent proves ownership; a
      // nullable one only narrows the choice to that parent's company.
      const parentCandidate =
        parent?.companyContextId && parent.agencyClientId
          ? (candidatesByClient
              .get(parent.agencyClientId)
              ?.find(
                (entry) => entry.companyContextId === parent.companyContextId,
              ) ?? null)
          : null;

      const possibleCompanies = parentCandidate
        ? [parentCandidate]
        : agencyClientId
          ? (candidatesByClient.get(agencyClientId) ?? [])
          : [];

      return {
        domainKey: domain.domainKey,
        rowId,
        agencyClientId,
        title: domain.titleColumn
          ? ((raw[domain.titleColumn] as string | null) ?? null)
          : null,
        createdAt: this.serialize(raw.created_at) as string | null,
        summary,
        possibleCompanies,
        automaticCandidate:
          domain.parentEvidence?.automatic === true ? parentCandidate : null,
        resolution:
          possibleCompanies.length > 0
            ? 'assignable'
            : 'requires_manual_research',
      };
    });
  }

  /**
   * Resolves the company scope of each row's persisted parent, when the
   * registry declares one.
   */
  private async loadParentScopes(
    ctx: RequestContext,
    domain: CompanyLegacyDomain,
    raws: Array<Record<string, unknown>>,
  ): Promise<
    Map<string, { agencyClientId: string | null; companyContextId: string | null }>
  > {
    const evidence = domain.parentEvidence;
    const scopes = new Map<
      string,
      { agencyClientId: string | null; companyContextId: string | null }
    >();
    if (!evidence) return scopes;

    const parentIds = [
      ...new Set(
        raws
          .map((raw) => raw[evidence.column] as string | null)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    if (parentIds.length === 0) return scopes;

    const parents = await this.query<{
      id: string;
      agency_client_id: string | null;
      company_context_id: string | null;
    }>(
      `SELECT "id", "agency_client_id", "company_context_id"
         FROM "${evidence.table}"
        WHERE "id" IN (:...parentIds)
          AND "tenant_id" = :tenantId
          AND "workspace_id" = :workspaceId`,
      {
        parentIds,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    );
    const byId = new Map(parents.map((parent) => [parent.id, parent]));

    for (const raw of raws) {
      const parentId = raw[evidence.column] as string | null;
      const parent = parentId ? byId.get(parentId) : undefined;
      if (!parent?.company_context_id) continue;
      scopes.set(String(raw.id), {
        agencyClientId: parent.agency_client_id,
        companyContextId: parent.company_context_id,
      });
    }

    return scopes;
  }

  /**
   * Candidate companies for a set of clients: active, non-archived contexts of
   * that client in this tenant/workspace. Never "every company in the
   * workspace" — a row with no known client gets no candidates at all.
   */
  private async loadCandidates(
    ctx: RequestContext,
    agencyClientIds: string[],
  ): Promise<Map<string, CompanyLegacyCandidate[]>> {
    const byClient = new Map<string, CompanyLegacyCandidate[]>();
    if (agencyClientIds.length === 0) return byClient;

    const rows = await this.query<{
      id: string;
      agency_client_id: string;
      display_name: string;
    }>(
      `SELECT context."id", context."agency_client_id", contact."display_name"
         FROM "agency_client_company_contexts" context
         JOIN "contacts" contact ON contact."id" = context."company_contact_id"
        WHERE context."agency_client_id" IN (:...agencyClientIds)
          AND context."tenant_id" = :tenantId
          AND context."workspace_id" = :workspaceId
          AND context."status" = 'active'
          AND context."archived_at" IS NULL
        ORDER BY contact."display_name" ASC`,
      {
        agencyClientIds,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    );

    for (const row of rows) {
      const list = byClient.get(row.agency_client_id) ?? [];
      list.push({ companyContextId: row.id, displayName: row.display_name });
      byClient.set(row.agency_client_id, list);
    }
    return byClient;
  }

  // ── Writing ───────────────────────────────────────────────────────────

  private async lockRow(
    manager: EntityManager,
    ctx: RequestContext,
    domain: CompanyLegacyDomain,
    rowId: string,
  ): Promise<Record<string, unknown> | null> {
    const columns = [
      'legacy_row."id" AS id',
      'legacy_row."company_context_id" AS company_context_id',
      'legacy_row."agency_client_id" AS agency_client_id',
      ...(domain.scopeEncoding === 'column'
        ? ['legacy_row."scope_kind" AS scope_kind']
        : []),
      ...(domain.parentEvidence
        ? [`legacy_row."${domain.parentEvidence.column}" AS parent_id`]
        : []),
    ].join(', ');

    const [row] = await this.query<Record<string, unknown>>(
      `SELECT ${columns} FROM "${domain.table}" legacy_row
        WHERE legacy_row."id" = :rowId
          AND legacy_row."tenant_id" = :tenantId
          AND legacy_row."workspace_id" = :workspaceId
        FOR UPDATE`,
      { rowId, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      manager,
    );
    return row ?? null;
  }

  private isLegacy(
    domain: CompanyLegacyDomain,
    row: Record<string, unknown>,
  ): boolean {
    if (row.company_context_id) return false;
    return domain.scopeEncoding === 'column'
      ? row.scope_kind === 'legacy_unassigned'
      : Boolean(row.agency_client_id);
  }

  private async loadCompanyContext(
    manager: EntityManager,
    ctx: RequestContext,
    companyContextId: string,
  ): Promise<AgencyClientCompanyContext> {
    const company = await manager
      .getRepository(AgencyClientCompanyContext)
      .findOne({
        where: {
          id: companyContextId,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      });

    // Tenant/workspace mismatch is indistinguishable from "does not exist" on
    // purpose: an admin of another workspace learns nothing.
    if (!company) {
      throw new NotFoundException('Company context not found.');
    }
    if (company.status !== 'active' || company.archivedAt) {
      throw new BadRequestException(
        'Only an active company context can receive legacy data.',
      );
    }
    return company;
  }

  /**
   * Refuses an assignment that would contradict a persisted parent, which is
   * how a cross-company parent/child pair would otherwise be created.
   */
  private async assertParentCompatible(
    manager: EntityManager,
    ctx: RequestContext,
    domain: CompanyLegacyDomain,
    row: Record<string, unknown>,
    company: AgencyClientCompanyContext,
  ): Promise<void> {
    const evidence = domain.parentEvidence;
    const parentId = row.parent_id as string | null | undefined;
    if (!evidence || !parentId) return;

    const [parent] = await this.query<{
      company_context_id: string | null;
    }>(
      `SELECT "company_context_id"
         FROM "${evidence.table}"
        WHERE "id" = :parentId
          AND "tenant_id" = :tenantId
          AND "workspace_id" = :workspaceId`,
      { parentId, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      manager,
    );

    // A parent that is itself still legacy constrains nothing.
    if (!parent?.company_context_id) return;
    if (parent.company_context_id !== company.id) {
      throw new BadRequestException(
        'This row belongs to a parent already assigned to another company.',
      );
    }
  }

  /**
   * The scope write. For `'column'` domains the client, the company and
   * `scope_kind` must move together or the table CHECK constraint rejects the
   * statement — the database is the final guard, not this method.
   */
  private async writeAssignment(
    manager: EntityManager,
    domain: CompanyLegacyDomain,
    rowId: string,
    company: AgencyClientCompanyContext,
  ): Promise<void> {
    const assignments =
      domain.scopeEncoding === 'column'
        ? `"agency_client_id" = :agencyClientId, "company_context_id" = :companyContextId, "scope_kind" = 'company'`
        : `"company_context_id" = :companyContextId`;

    const guard =
      domain.scopeEncoding === 'column'
        ? `"scope_kind" = 'legacy_unassigned'`
        : `"agency_client_id" = :agencyClientId AND "company_context_id" IS NULL`;

    // `RETURNING "id"` makes the affected count unambiguous: TypeORM answers a
    // bare UPDATE with a driver result object, but an UPDATE ... RETURNING
    // with the `[rows, rowCount]` pair, so we can read the rows directly
    // instead of guessing which shape came back.
    const result = await manager.query(
      ...this.bind(
        `UPDATE "${domain.table}"
            SET ${assignments}
          WHERE "id" = :rowId
            AND "company_context_id" IS NULL
            AND ${guard}
        RETURNING "id"`,
        {
          rowId,
          agencyClientId: company.agencyClientId,
          companyContextId: company.id,
        },
      ),
    );

    // Belt and braces: the row was locked above, so a zero-row update means
    // the legacy state changed underneath us.
    const updated = Array.isArray(result)
      ? (Array.isArray(result[0]) ? result[0] : result)
      : [];
    if (updated.length === 0) {
      throw new ConflictException(
        'This row is no longer pending: it was already assigned to a company.',
      );
    }
  }

  // ── Query plumbing ────────────────────────────────────────────────────

  /**
   * Named parameters over raw SQL. Table and column names come exclusively
   * from the static registry — never from request input — while every value
   * is bound, so neither half of a query is attacker-controlled.
   */
  private bind(
    sql: string,
    params: Record<string, unknown>,
  ): [string, unknown[]] {
    const values: unknown[] = [];
    // `(?<!:)` and `(?!:)` keep Postgres casts (`count(*)::text`, `$1::uuid`)
    // from being read as named parameters — without them `::text` binds a
    // parameter called `text` and silently corrupts the statement.
    const text = sql.replace(
      /(?<!:):(\.\.\.)?([A-Za-z_][A-Za-z0-9_]*)(?!:)/g,
      (_match, spread: string | undefined, key: string) => {
        const value = params[key];
        if (spread) {
          const list = Array.isArray(value) ? value : [value];
          return list
            .map((entry) => {
              values.push(entry);
              return `$${values.length}`;
            })
            .join(', ');
        }
        values.push(value);
        return `$${values.length}`;
      },
    );
    return [text, values];
  }

  private query<T>(
    sql: string,
    params: Record<string, unknown>,
    manager?: EntityManager,
  ): Promise<T[]> {
    const [text, values] = this.bind(sql, params);
    return (manager ?? this.dataSource).query(text, values) as Promise<T[]>;
  }

  private serialize(value: unknown): unknown {
    return value instanceof Date ? value.toISOString() : (value ?? null);
  }
}
