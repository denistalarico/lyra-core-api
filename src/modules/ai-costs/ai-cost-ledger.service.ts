import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import type {
  AiCostOutcome,
  AiCostSource,
  AiCostStatus,
  AiCostUnknownReason,
} from './entities';

/**
 * How much a recorded amount can be trusted, derived from its source (never
 * stored twice): money the provider reported or that was reconciled against
 * an external statement is authoritative; units × a versioned price is
 * calculated; Lyra's own estimate is estimated.
 */
export type AiCostConfidence = 'authoritative' | 'calculated' | 'estimated';

export type AiCostCorrelation = {
  contentItemId: string | null;
  projectId: string | null;
  taskId: string | null;
};

/** What a producing domain hands the ledger for one paid operation. */
export type AiCostEntryInput = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId: string | null;
  sourceDomain: string;
  sourceType: string;
  sourceId: string;
  logicalType: string;
  logicalId: string;
  operationKind: string;
  provider: string;
  model: string | null;
  outcome: AiCostOutcome;
  usage: {
    unit: string | null;
    quantity: string | null;
    metrics: Record<string, number> | null;
  };
  unitPrice: string | null;
  pricingVersion: string | null;
  cost:
    | {
        status: 'known';
        amount: string;
        currency: string;
        source: AiCostSource;
      }
    | { status: 'unknown'; reason: AiCostUnknownReason };
  occurredAt: Date;
  correlation: AiCostCorrelation;
  metadata: Record<string, unknown>;
};

/** Provider-neutral view of one ledger row (drill-down). */
export type AiCostEntryView = {
  id: string;
  sourceDomain: string;
  sourceType: string;
  sourceId: string;
  logicalType: string;
  logicalId: string;
  operationKind: string;
  provider: string;
  model: string | null;
  outcome: AiCostOutcome;
  costStatus: AiCostStatus;
  amount: string | null;
  currency: string | null;
  costSource: AiCostSource | null;
  confidence: AiCostConfidence | null;
  unknownReason: AiCostUnknownReason | null;
  pricingVersion: string | null;
  usageUnit: string | null;
  usageQuantity: string | null;
  unitPrice: string | null;
  occurredAt: string;
  agencyClientId: string | null;
  companyContextId: string | null;
  contentItemId: string | null;
  projectId: string | null;
  taskId: string | null;
  correlatedAt: string | null;
  metadata: Record<string, unknown>;
};

/**
 * Filter of every read. Tenant and workspace are mandatory. `agencyClientId`
 * `null` means the tenant's own operation (no client); `undefined` = any.
 * `from` is inclusive, `to` exclusive, both on `occurred_at`.
 */
export type AiCostFilter = {
  tenantId: string;
  workspaceId: string;
  from?: Date;
  to?: Date;
  agencyClientId?: string | null;
  companyContextId?: string | null;
  projectId?: string;
  taskId?: string;
  contentItemId?: string;
  sourceDomain?: string;
  logical?: readonly { type: string; id: string }[];
};

export type AiCostGroupBy =
  | 'none'
  | 'client'
  | 'project'
  | 'task'
  | 'content_item'
  | 'month';

/** One currency of a summary. Units counted are logical (one Reel = 1). */
export type AiCostCurrencyTotal = {
  currency: string;
  amount: string;
  operations: number;
  generations: number;
};

export type AiCostSummary = {
  totals: AiCostCurrencyTotal[];
  /** Paid operations whose cost is unknown: never counted as zero. */
  unknownOperations: number;
  operations: number;
  generations: number;
};

export const EMPTY_AI_COST_SUMMARY: AiCostSummary = Object.freeze({
  totals: [],
  unknownOperations: 0,
  operations: 0,
  generations: 0,
}) as AiCostSummary;

const MAX_ENTRIES = 1000;
const MAX_PAGE = 200;

const GROUP_KEY: Record<AiCostGroupBy, string> = {
  none: 'NULL::text',
  client: 'agency_client_id::text',
  project: 'project_id::text',
  task: 'task_id::text',
  content_item: 'content_item_id::text',
  month: `to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM')`,
};

/**
 * CS6-B — the AI operational cost ledger (`ai_operational_costs`).
 *
 * The only door to the table: producing domains write through `record` and
 * `updateCorrelations`; Finance and the producing domains read through the
 * provider-neutral read model below. Nothing here knows a provider's tables.
 *
 * Every amount leaves as a decimal string per currency, summed in SQL
 * (`numeric`). Converting currencies is not this layer's job — there is no
 * FX in the platform.
 */
@Injectable()
export class AiCostLedgerService {
  private readonly logger = new Logger(AiCostLedgerService.name);

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  // ── write ───────────────────────────────────────────────────────────────

  /**
   * Records each operation at most once (`ON CONFLICT DO NOTHING` on the
   * source key), and upgrades a row from `unknown` to `known` when the
   * producer now knows the cost. A `known` row is never rewritten.
   */
  async record(
    entries: readonly AiCostEntryInput[],
    manager: EntityManager = this.dataSource.manager,
  ): Promise<{ inserted: number; upgraded: number }> {
    let inserted = 0;
    let upgraded = 0;
    for (const entry of entries) {
      const known = entry.cost.status === 'known' ? entry.cost : null;
      const unknownReason =
        entry.cost.status === 'unknown' ? entry.cost.reason : null;
      const rows = returned<{ id: string }>(
        await manager.query(
          `INSERT INTO ai_operational_costs (
             tenant_id, workspace_id, agency_client_id, company_context_id,
             source_domain, source_type, source_id, logical_type, logical_id,
             operation_kind, provider, model, outcome,
             usage_unit, usage_quantity, usage_metrics, unit_price, pricing_version,
             cost_status, provider_cost, provider_currency, cost_source, unknown_reason,
             occurred_at, content_item_id, project_id, task_id, correlated_at, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::numeric,$16::jsonb,
                   $17::numeric,$18,$19,$20::numeric,$21,$22,$23,$24,$25,$26,$27,
                   CASE WHEN $25::uuid IS NULL AND $26::uuid IS NULL AND $27::uuid IS NULL
                        THEN NULL ELSE now() END,
                   $28::jsonb)
           ON CONFLICT ON CONSTRAINT "UQ_ai_operational_costs_source" DO NOTHING
           RETURNING id`,
          [
            entry.tenantId,
            entry.workspaceId,
            entry.agencyClientId,
            entry.companyContextId,
            entry.sourceDomain,
            entry.sourceType,
            entry.sourceId,
            entry.logicalType,
            entry.logicalId,
            entry.operationKind,
            entry.provider,
            entry.model,
            entry.outcome,
            entry.usage.unit,
            entry.usage.quantity,
            entry.usage.metrics ? JSON.stringify(entry.usage.metrics) : null,
            entry.unitPrice,
            entry.pricingVersion,
            entry.cost.status,
            known?.amount ?? null,
            known?.currency ?? null,
            known?.source ?? null,
            unknownReason,
            entry.occurredAt,
            entry.correlation.contentItemId,
            entry.correlation.projectId,
            entry.correlation.taskId,
            JSON.stringify(entry.metadata),
          ],
        ),
      );
      if (rows.length) {
        inserted += 1;
        this.logger.log(
          `ai cost recorded id=${rows[0].id} source=${entry.sourceType}:${entry.sourceId} logical=${entry.logicalType}:${entry.logicalId} provider=${entry.provider} model=${entry.model ?? '-'} pricing=${entry.pricingVersion ?? '-'} status=${entry.cost.status} amount=${known?.amount ?? '-'} currency=${known?.currency ?? '-'} client=${entry.agencyClientId ?? 'own'} item=${entry.correlation.contentItemId ?? '-'} project=${entry.correlation.projectId ?? '-'} task=${entry.correlation.taskId ?? '-'}`,
        );
        continue;
      }
      if (!known) continue;
      const lifted = returned<{ id: string }>(
        await manager.query(
          `UPDATE ai_operational_costs
              SET cost_status = 'known', provider_cost = $4::numeric,
                  provider_currency = $5, cost_source = $6, unknown_reason = NULL,
                  pricing_version = $7, unit_price = $8::numeric,
                  usage_unit = $9, usage_quantity = $10::numeric,
                  usage_metrics = $11::jsonb, updated_at = now()
            WHERE source_domain = $1 AND source_type = $2 AND source_id = $3
              AND cost_status = 'unknown'
            RETURNING id`,
          [
            entry.sourceDomain,
            entry.sourceType,
            entry.sourceId,
            known.amount,
            known.currency,
            known.source,
            entry.pricingVersion,
            entry.unitPrice,
            entry.usage.unit,
            entry.usage.quantity,
            entry.usage.metrics ? JSON.stringify(entry.usage.metrics) : null,
          ],
        ),
      );
      if (lifted.length) {
        upgraded += 1;
        this.logger.log(
          `ai cost reconciled id=${lifted[0].id} source=${entry.sourceType}:${entry.sourceId} pricing=${entry.pricingVersion ?? '-'} amount=${known.amount} currency=${known.currency}`,
        );
      }
    }
    return { inserted, upgraded };
  }

  /**
   * Rewrites the correlation projection of the given rows, only where it
   * changed. Economic columns are untouched (and guarded by the trigger).
   */
  async updateCorrelations(
    rows: readonly ({ id: string } & AiCostCorrelation)[],
    manager: EntityManager = this.dataSource.manager,
  ): Promise<number> {
    if (!rows.length) return 0;
    const updated = returned<{
      id: string;
      content_item_id: string | null;
      project_id: string | null;
      task_id: string | null;
    }>(
      await manager.query(
        `UPDATE ai_operational_costs cost
            SET content_item_id = desired.content_item_id,
                project_id = desired.project_id,
                task_id = desired.task_id,
                correlated_at = now(), updated_at = now()
           FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[])
                AS desired(id, content_item_id, project_id, task_id)
          WHERE cost.id = desired.id
            AND (cost.content_item_id, cost.project_id, cost.task_id)
                IS DISTINCT FROM
                (desired.content_item_id, desired.project_id, desired.task_id)
          RETURNING cost.id, cost.content_item_id, cost.project_id, cost.task_id`,
        [
          rows.map((row) => row.id),
          rows.map((row) => row.contentItemId),
          rows.map((row) => row.projectId),
          rows.map((row) => row.taskId),
        ],
      ),
    );
    for (const row of updated)
      this.logger.log(
        `ai cost correlated id=${row.id} item=${row.content_item_id ?? '-'} project=${row.project_id ?? '-'} task=${row.task_id ?? '-'}`,
      );
    return updated.length;
  }

  // ── read ────────────────────────────────────────────────────────────────

  /** Per-key, per-currency totals. Unknown rows are counted, never summed. */
  async summarize(
    filter: AiCostFilter,
    groupBy: AiCostGroupBy = 'none',
  ): Promise<Map<string | null, AiCostSummary>> {
    const { where, params } = this.where(filter);
    const key = GROUP_KEY[groupBy];
    const rows = await this.dataSource.query<
      {
        key: string | null;
        currency: string | null;
        amount: string | null;
        operations: number;
        generations: number;
        unknown_operations: number;
        by_currency: boolean;
      }[]
    >(
      `SELECT ${key} AS key,
              provider_currency AS currency,
              sum(provider_cost)::text AS amount,
              count(*)::int AS operations,
              count(DISTINCT source_domain || ':' || logical_type || ':' || logical_id)::int AS generations,
              count(*) FILTER (WHERE cost_status = 'unknown')::int AS unknown_operations,
              GROUPING(provider_currency) = 0 AS by_currency
         FROM ai_operational_costs
        WHERE ${where}
        GROUP BY GROUPING SETS ((${key}, provider_currency), (${key}))`,
      params,
    );
    const result = new Map<string | null, AiCostSummary>();
    const ensure = (k: string | null) => {
      let summary = result.get(k);
      if (!summary) {
        summary = {
          totals: [],
          unknownOperations: 0,
          operations: 0,
          generations: 0,
        };
        result.set(k, summary);
      }
      return summary;
    };
    for (const row of rows) {
      const summary = ensure(row.key);
      if (!row.by_currency) {
        summary.operations = row.operations;
        summary.generations = row.generations;
        summary.unknownOperations = row.unknown_operations;
      } else if (row.currency !== null && row.amount !== null) {
        summary.totals.push({
          currency: row.currency.trim(),
          amount: row.amount,
          operations: row.operations,
          generations: row.generations,
        });
      }
    }
    for (const summary of result.values())
      summary.totals.sort((a, b) => a.currency.localeCompare(b.currency));
    return result;
  }

  /** Rows for an aggregate's drill-down, bounded (no pagination). */
  async entries(filter: AiCostFilter): Promise<AiCostEntryView[]> {
    const { where, params } = this.where(filter);
    const rows = await this.dataSource.query<Record<string, unknown>[]>(
      `SELECT * FROM ai_operational_costs WHERE ${where}
        ORDER BY occurred_at ASC, id ASC LIMIT ${MAX_ENTRIES}`,
      params,
    );
    return rows.map(toView);
  }

  /** Paginated drill-down, newest first, keyset cursor. */
  async page(
    filter: AiCostFilter,
    options: { cursor?: string; limit?: number },
  ): Promise<{ items: AiCostEntryView[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), MAX_PAGE);
    const { where, params } = this.where(filter);
    let clause = where;
    if (options.cursor) {
      const cursor = decodeCursor(options.cursor);
      params.push(cursor.occurredAt, cursor.id);
      clause += ` AND (occurred_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
    const rows = await this.dataSource.query<Record<string, unknown>[]>(
      `SELECT * FROM ai_operational_costs WHERE ${clause}
        ORDER BY occurred_at DESC, id DESC LIMIT ${limit + 1}`,
      params,
    );
    const items = rows.slice(0, limit).map(toView);
    const last = items[items.length - 1];
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? encodeCursor(last.occurredAt, last.id)
          : null,
    };
  }

  private where(filter: AiCostFilter): { where: string; params: unknown[] } {
    const params: unknown[] = [filter.tenantId, filter.workspaceId];
    const clauses = ['tenant_id = $1', 'workspace_id = $2'];
    const add = (sql: (n: number) => string, value: unknown) => {
      params.push(value);
      clauses.push(sql(params.length));
    };
    if (filter.from) add((n) => `occurred_at >= $${n}`, filter.from);
    if (filter.to) add((n) => `occurred_at < $${n}`, filter.to);
    if (filter.agencyClientId === null)
      clauses.push('agency_client_id IS NULL');
    else if (filter.agencyClientId !== undefined)
      add((n) => `agency_client_id = $${n}::uuid`, filter.agencyClientId);
    if (filter.companyContextId === null)
      clauses.push('company_context_id IS NULL');
    else if (filter.companyContextId !== undefined)
      add((n) => `company_context_id = $${n}::uuid`, filter.companyContextId);
    if (filter.projectId)
      add((n) => `project_id = $${n}::uuid`, filter.projectId);
    if (filter.taskId) add((n) => `task_id = $${n}::uuid`, filter.taskId);
    if (filter.contentItemId)
      add((n) => `content_item_id = $${n}::uuid`, filter.contentItemId);
    if (filter.sourceDomain)
      add((n) => `source_domain = $${n}`, filter.sourceDomain);
    if (filter.logical) {
      if (!filter.logical.length) clauses.push('false');
      else {
        params.push(
          filter.logical.map((ref) => ref.type),
          filter.logical.map((ref) => ref.id),
        );
        clauses.push(
          `(logical_type, logical_id) IN (SELECT * FROM unnest($${params.length - 1}::text[], $${params.length}::text[]))`,
        );
      }
    }
    return { where: clauses.join(' AND '), params };
  }
}

export function confidenceOf(
  source: AiCostSource | null,
): AiCostConfidence | null {
  switch (source) {
    case 'provider_reported':
    case 'reconciled':
      return 'authoritative';
    case 'lyra_calculated':
      return 'calculated';
    case 'estimated':
      return 'estimated';
    default:
      return null;
  }
}

function toView(row: Record<string, unknown>): AiCostEntryView {
  // Raw rows carry only strings, numbers and dates (numeric → string).
  const text = (value: unknown) =>
    value === null || value === undefined
      ? null
      : String(value as string | number);
  const date = (value: unknown) =>
    value === null || value === undefined
      ? null
      : new Date(value as string | Date).toISOString();
  const source = (row.cost_source as AiCostSource | null) ?? null;
  return {
    id: String(row.id),
    sourceDomain: String(row.source_domain),
    sourceType: String(row.source_type),
    sourceId: String(row.source_id),
    logicalType: String(row.logical_type),
    logicalId: String(row.logical_id),
    operationKind: String(row.operation_kind),
    provider: String(row.provider),
    model: text(row.model),
    outcome: row.outcome as AiCostOutcome,
    costStatus: row.cost_status as AiCostStatus,
    amount: text(row.provider_cost),
    currency: text(row.provider_currency)?.trim() ?? null,
    costSource: source,
    confidence: confidenceOf(source),
    unknownReason: (row.unknown_reason as AiCostUnknownReason | null) ?? null,
    pricingVersion: text(row.pricing_version),
    usageUnit: text(row.usage_unit),
    usageQuantity: text(row.usage_quantity),
    unitPrice: text(row.unit_price),
    occurredAt: date(row.occurred_at) as string,
    agencyClientId: text(row.agency_client_id),
    companyContextId: text(row.company_context_id),
    contentItemId: text(row.content_item_id),
    projectId: text(row.project_id),
    taskId: text(row.task_id),
    correlatedAt: date(row.correlated_at),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

function encodeCursor(occurredAt: string, id: string) {
  return Buffer.from(`${occurredAt}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { occurredAt: string; id: string } {
  const [occurredAt, id] = Buffer.from(cursor, 'base64url')
    .toString('utf8')
    .split('|');
  if (
    !occurredAt ||
    Number.isNaN(Date.parse(occurredAt)) ||
    !/^[0-9a-f-]{36}$/i.test(id ?? '')
  )
    throw new BadRequestException({
      code: 'invalid_cursor',
      message: 'Cursor inválido.',
    });
  return { occurredAt, id };
}

/** `manager.query` returns `[rows, count]` for UPDATE … RETURNING. */
function returned<T>(result: unknown): T[] {
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  )
    return result[0] as T[];
  return result as T[];
}
