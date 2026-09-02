import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import {
  DataSource,
  FindOptionsWhere,
  IsNull,
  LessThan,
  Repository,
} from 'typeorm';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import {
  CollectLeadFlowTelemetryDto,
  LEADFLOW_PRODUCT_TELEMETRY_PURPOSE,
  OptInLeadFlowTelemetryDto,
  OptOutLeadFlowTelemetryDto,
  TelemetryErasureDto,
} from '../dto/telemetry-consent.dto';
import {
  LeadFlowProductTelemetryDailyEntity,
  LeadFlowTelemetryAuditEventEntity,
  LeadFlowTelemetryConsentEntity,
  LeadFlowTelemetryConsentNoticeEntity,
  LeadFlowTelemetryIdentityLinkEntity,
} from '../entities';
import type {
  LeadFlowProductTelemetryAggregate,
  LeadFlowTelemetryCollectionResponse,
  LeadFlowTelemetryStatusResponse,
} from '../types/leadflow-telemetry.types';

type TelemetryScope = {
  tenantId: string;
  workspaceId: string;
  contextType: LeadFlowSettingsContextType;
  agencyClientId: string | null;
};

type AutomationRunCountRow = {
  observed_on: string | Date;
  status: 'succeeded' | 'failed';
  total: string;
};

const PURPOSE_DESCRIPTION =
  'Melhorar confiabilidade e desempenho do LeadFlow usando somente contagens operacionais estruturadas e agregadas.';

/**
 * The purpose a call operates on (Lyra Social S1.4.8).
 *
 * Every public method below takes this explicitly instead of assuming the
 * LeadFlow one, because the consent tables discriminate by `purpose_key`,
 * not by product. The LeadFlow routes keep passing the LeadFlow purpose and
 * behave exactly as before; the neutral `/platform/privacy/telemetry*`
 * routes pass the platform purpose.
 *
 * The critical invariant this type enables: consent lookups are filtered by
 * `purposeKey`. Without that filter, a legacy `leadflow_product_improvement_v1`
 * row would be returned as "the latest consent" for the neutral purpose —
 * silently promoting an old acceptance to a scope it never covered, which
 * D-4 / architecture §8.1 explicitly forbid.
 */
export type TelemetryPurpose = {
  key: string;
  description: string;
  /**
   * When true, a new opt-in is refused unless the notice carries
   * `legal_review_status = 'approved'` (S1.4.8 pointed correction).
   *
   * This is opt-in per purpose rather than a blanket rule because the legacy
   * LeadFlow notice is seeded as `'pending'` by migration 1788200000000 and
   * has been accepted in that state — turning the gate on globally would
   * retroactively break the LeadFlow opt-in that works today. The neutral
   * purpose has no such history, so it starts gated.
   *
   * Collection is unaffected by this flag: `collectSnapshot` already refuses
   * to collect for ANY purpose whose notice is not approved, and that
   * fail-closed behaviour predates this change.
   */
  requiresApprovedNoticeToOptIn?: boolean;
};

export const LEADFLOW_TELEMETRY_PURPOSE: TelemetryPurpose = {
  key: LEADFLOW_PRODUCT_TELEMETRY_PURPOSE,
  description: PURPOSE_DESCRIPTION,
  // Unchanged legacy behaviour — see the field docs above.
  requiresApprovedNoticeToOptIn: false,
};
const DEFAULT_RETENTION_DAYS = 90;
const MINIMUM_K_ANONYMITY = 5;
const MAX_COLLECTION_DAYS = 31;
const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class LeadFlowTelemetryPrivacyService {
  private readonly logger = new Logger(LeadFlowTelemetryPrivacyService.name);
  private retentionRunning = false;

  constructor(
    @InjectDataSource('agency')
    private readonly dataSource: DataSource,
    @InjectRepository(LeadFlowTelemetryConsentNoticeEntity, 'agency')
    private readonly notices: Repository<LeadFlowTelemetryConsentNoticeEntity>,
    @InjectRepository(LeadFlowTelemetryConsentEntity, 'agency')
    private readonly consents: Repository<LeadFlowTelemetryConsentEntity>,
    @InjectRepository(LeadFlowTelemetryIdentityLinkEntity, 'agency')
    private readonly identities: Repository<LeadFlowTelemetryIdentityLinkEntity>,
    @InjectRepository(LeadFlowProductTelemetryDailyEntity, 'agency')
    private readonly dailyFacts: Repository<LeadFlowProductTelemetryDailyEntity>,
    @InjectRepository(LeadFlowTelemetryAuditEventEntity, 'agency')
    private readonly auditEvents: Repository<LeadFlowTelemetryAuditEventEntity>,
  ) {}

  async getStatus(
    ctx: RequestContext,
    purpose: TelemetryPurpose = LEADFLOW_TELEMETRY_PURPOSE,
  ): Promise<LeadFlowTelemetryStatusResponse> {
    const scope = this.resolveScope(ctx);
    const [notice, consent, identity, recentAudit] = await Promise.all([
      this.getCurrentNotice(purpose.key),
      this.findLatestConsent(this.consents, scope, purpose.key),
      this.identities.findOne({ where: this.identityWhere(scope) }),
      this.auditEvents.find({
        where: this.scopeWhere(scope),
        order: { occurredAt: 'DESC', createdAt: 'DESC' },
        take: 10,
      }),
    ]);
    const contributedDailyFacts = identity
      ? await this.dailyFacts.count({
          where: { scopePseudonym: identity.scopePseudonym },
        })
      : 0;
    const requiresRenewal =
      consent?.status === 'opted_in' &&
      (!notice ||
        consent.noticeId !== notice.id ||
        consent.noticeContentHash !== notice.contentHash);
    const eligible =
      this.isCollectionEnabled() &&
      consent?.status === 'opted_in' &&
      !requiresRenewal &&
      notice?.legalReviewStatus === 'approved';

    return {
      purpose: {
        key: purpose.key,
        description: purpose.description,
      },
      notice: notice
        ? {
            id: notice.id,
            version: notice.version,
            locale: notice.locale,
            title: notice.title,
            body: notice.body,
            contentHash: notice.contentHash,
            categories: notice.categories,
            retentionDays: notice.retentionDays,
            kAnonymityThreshold: notice.kAnonymityThreshold,
            legalReviewStatus: notice.legalReviewStatus,
            effectiveAt: notice.effectiveAt.toISOString(),
          }
        : null,
      consent: {
        state: consent?.status ?? 'not_configured',
        occurredAt: consent?.occurredAt.toISOString() ?? null,
        noticeVersion: consent?.noticeVersion ?? null,
        noticeContentHash: consent?.noticeContentHash ?? null,
        requiresRenewal,
      },
      collection: {
        platformGateEnabled: this.isCollectionEnabled(),
        eligible,
        lastCollectedAt: identity?.lastCollectedAt?.toISOString() ?? null,
        contributedDailyFacts,
      },
      guarantees: {
        noMessageContent: true,
        noContactIdentity: true,
        pseudonymousFacts: true,
        identitySeparated: true,
        minimumAggregateScopes: Math.max(
          notice?.kAnonymityThreshold ?? MINIMUM_K_ANONYMITY,
          MINIMUM_K_ANONYMITY,
        ),
        optOutStopsCollection: true,
        erasureAvailable: true,
      },
      recentAudit: recentAudit.map((event) => ({
        action: event.action,
        occurredAt: event.occurredAt.toISOString(),
        noticeVersion: event.noticeVersion,
        details: event.details,
      })),
    };
  }

  async optIn(
    ctx: RequestContext,
    dto: OptInLeadFlowTelemetryDto,
    purpose: TelemetryPurpose = LEADFLOW_TELEMETRY_PURPOSE,
  ): Promise<LeadFlowTelemetryStatusResponse> {
    const scope = this.resolveScope(ctx);
    const notice = await this.notices.findOne({ where: { id: dto.noticeId } });
    // The notice must belong to the purpose being consented to. This is what
    // stops a caller from opting in to the neutral purpose by pointing at the
    // legacy LeadFlow notice (or vice versa).
    if (
      !notice ||
      notice.status !== 'active' ||
      notice.purposeKey !== purpose.key
    ) {
      throw new NotFoundException(
        'O texto de consentimento selecionado não está ativo.',
      );
    }
    if (
      dto.purposeKey !== notice.purposeKey ||
      dto.contentHash !== notice.contentHash
    ) {
      throw new ConflictException(
        'O texto de consentimento mudou. Recarregue a página e revise a versão atual.',
      );
    }
    // Legal-review gate (S1.4.8 pointed correction). A notice that has not
    // been cleared for use must not accumulate NEW acceptances — hiding the
    // button is not enough, since the endpoint is reachable directly. Only
    // opt-in is gated: opt-out and erasure stay available so a legal status
    // can never trap someone in a consent they want to withdraw.
    if (
      purpose.requiresApprovedNoticeToOptIn &&
      notice.legalReviewStatus !== 'approved'
    ) {
      throw new ConflictException(
        'Este texto de consentimento ainda não está liberado para uso. Nenhuma nova autorização pode ser registrada até a conclusão da revisão.',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const consentRepository = manager.getRepository(
        LeadFlowTelemetryConsentEntity,
      );
      const current = await this.findLatestConsent(
        consentRepository,
        scope,
        purpose.key,
      );
      if (
        current?.status === 'opted_in' &&
        current.noticeId === notice.id &&
        current.noticeContentHash === notice.contentHash
      ) {
        return;
      }
      const now = new Date();
      await consentRepository.save(
        consentRepository.create({
          ...scope,
          noticeId: notice.id,
          purposeKey: notice.purposeKey,
          status: 'opted_in',
          actorUserId: ctx.userId ?? null,
          reasonCode: null,
          noticeVersion: notice.version,
          noticeContentHash: notice.contentHash,
          occurredAt: now,
        }),
      );
      const identityRepository = manager.getRepository(
        LeadFlowTelemetryIdentityLinkEntity,
      );
      const identity = await identityRepository.findOne({
        where: this.identityWhere(scope),
      });
      if (identity) {
        identity.optedOutAt = null;
        await identityRepository.save(identity);
      }
      await this.appendAudit(
        manager.getRepository(LeadFlowTelemetryAuditEventEntity),
        scope,
        ctx.userId,
        'consent_opted_in',
        notice,
        now,
        {
          purposeKey: notice.purposeKey,
          legalReviewStatus: notice.legalReviewStatus,
        },
      );
    });

    return this.getStatus(ctx, purpose);
  }

  async optOut(
    ctx: RequestContext,
    dto: OptOutLeadFlowTelemetryDto,
    purpose: TelemetryPurpose = LEADFLOW_TELEMETRY_PURPOSE,
  ): Promise<LeadFlowTelemetryStatusResponse> {
    const scope = this.resolveScope(ctx);
    await this.dataSource.transaction(async (manager) => {
      const consentRepository = manager.getRepository(
        LeadFlowTelemetryConsentEntity,
      );
      const current = await this.findLatestConsent(
        consentRepository,
        scope,
        purpose.key,
      );
      if (current?.status === 'opted_out') return;
      const now = new Date();
      // Append-only: the opt-out is a NEW row carrying the same purpose.
      // The prior acceptance stays on disk as history (D-4: nenhuma linha
      // gravada é reescrita).
      await consentRepository.save(
        consentRepository.create({
          ...scope,
          noticeId: current?.noticeId ?? null,
          purposeKey: purpose.key,
          status: 'opted_out',
          actorUserId: ctx.userId ?? null,
          reasonCode: dto.reasonCode,
          noticeVersion: current?.noticeVersion ?? null,
          noticeContentHash: current?.noticeContentHash ?? null,
          occurredAt: now,
        }),
      );
      const identityRepository = manager.getRepository(
        LeadFlowTelemetryIdentityLinkEntity,
      );
      const identity = await identityRepository.findOne({
        where: this.identityWhere(scope),
      });
      if (identity) {
        identity.optedOutAt = now;
        await identityRepository.save(identity);
      }
      await this.appendAudit(
        manager.getRepository(LeadFlowTelemetryAuditEventEntity),
        scope,
        ctx.userId,
        'consent_opted_out',
        null,
        now,
        { reasonCode: dto.reasonCode },
        current,
      );
    });

    return this.getStatus(ctx, purpose);
  }

  async eraseContribution(
    ctx: RequestContext,
    dto: TelemetryErasureDto,
    purpose: TelemetryPurpose = LEADFLOW_TELEMETRY_PURPOSE,
  ): Promise<LeadFlowTelemetryStatusResponse> {
    const scope = this.resolveScope(ctx);
    await this.dataSource.transaction(async (manager) => {
      const consentRepository = manager.getRepository(
        LeadFlowTelemetryConsentEntity,
      );
      const current = await this.findLatestConsent(
        consentRepository,
        scope,
        purpose.key,
      );
      const identityRepository = manager.getRepository(
        LeadFlowTelemetryIdentityLinkEntity,
      );
      const identity = await identityRepository.findOne({
        where: this.identityWhere(scope),
        lock: { mode: 'pessimistic_write' },
      });
      let deletedFacts = 0;
      if (identity) {
        const result = await manager.delete(
          LeadFlowProductTelemetryDailyEntity,
          {
            scopePseudonym: identity.scopePseudonym,
          },
        );
        deletedFacts = result.affected ?? 0;
        await identityRepository.remove(identity);
      }
      const now = new Date();
      await consentRepository.save(
        consentRepository.create({
          ...scope,
          noticeId: current?.noticeId ?? null,
          purposeKey: purpose.key,
          status: 'erased',
          actorUserId: ctx.userId ?? null,
          reasonCode: dto.reasonCode,
          noticeVersion: current?.noticeVersion ?? null,
          noticeContentHash: current?.noticeContentHash ?? null,
          occurredAt: now,
        }),
      );
      await this.appendAudit(
        manager.getRepository(LeadFlowTelemetryAuditEventEntity),
        scope,
        ctx.userId,
        'telemetry_erasure_completed',
        null,
        now,
        { deletedFacts, reasonCode: dto.reasonCode },
        current,
      );
    });

    return this.getStatus(ctx, purpose);
  }

  async collectSnapshot(
    ctx: RequestContext,
    dto: CollectLeadFlowTelemetryDto,
    purpose: TelemetryPurpose = LEADFLOW_TELEMETRY_PURPOSE,
  ): Promise<LeadFlowTelemetryCollectionResponse> {
    if (!this.isCollectionEnabled()) {
      throw new ConflictException(
        'A coleta de telemetria está desabilitada no gate da plataforma.',
      );
    }
    const scope = this.resolveScope(ctx);
    const period = this.parseCollectionPeriod(dto);
    const notice = await this.getCurrentNotice(purpose.key);
    const consent = await this.findLatestConsent(
      this.consents,
      scope,
      purpose.key,
    );
    if (
      !notice ||
      consent?.status !== 'opted_in' ||
      consent.noticeId !== notice.id ||
      consent.noticeContentHash !== notice.contentHash
    ) {
      throw new ConflictException(
        'É necessário aceitar explicitamente a versão atual do consentimento antes da coleta.',
      );
    }
    if (notice.legalReviewStatus !== 'approved') {
      throw new ConflictException(
        'A coleta permanece bloqueada até a aprovação jurídica do texto vigente.',
      );
    }

    const rows = await this.queryAutomationRunCounts(
      scope,
      period.from,
      period.to,
    );
    const byDay = new Map<string, { terminal: number; failed: number }>();
    for (const row of rows) {
      const observedOn = this.toDateKey(row.observed_on);
      const current = byDay.get(observedOn) ?? { terminal: 0, failed: 0 };
      const total = Number(row.total);
      current.terminal += total;
      if (row.status === 'failed') current.failed += total;
      byDay.set(observedOn, current);
    }

    let identity = await this.identities.findOne({
      where: this.identityWhere(scope),
    });
    if (!identity) {
      identity = this.identities.create({
        ...scope,
        scopePseudonym: randomUUID(),
        lastCollectedAt: null,
        optedOutAt: null,
      });
      identity = await this.identities.save(identity);
    }
    if (identity.optedOutAt) {
      throw new ConflictException(
        'O contexto está em opt-out e não pode receber novas coletas.',
      );
    }

    const facts = [...byDay.entries()].flatMap(([observedOn, counts]) => [
      this.dailyFacts.create({
        scopePseudonym: identity.scopePseudonym,
        observedOn,
        metricKey: 'automation_live_terminal_runs',
        dimensionKey: 'all',
        metricValue: String(counts.terminal),
        sampleSize: counts.terminal,
        sourcePeriodFrom: period.from,
        sourcePeriodTo: period.to,
      }),
      this.dailyFacts.create({
        scopePseudonym: identity.scopePseudonym,
        observedOn,
        metricKey: 'automation_live_failed_runs',
        dimensionKey: 'all',
        metricValue: String(counts.failed),
        sampleSize: counts.terminal,
        sourcePeriodFrom: period.from,
        sourcePeriodTo: period.to,
      }),
    ]);
    if (facts.length) {
      await this.dailyFacts.upsert(facts, {
        conflictPaths: [
          'scopePseudonym',
          'observedOn',
          'metricKey',
          'dimensionKey',
        ],
        skipUpdateIfNoValuesChanged: true,
      });
    }
    identity.lastCollectedAt = new Date();
    await this.identities.save(identity);

    const terminalRuns = [...byDay.values()].reduce(
      (sum, value) => sum + value.terminal,
      0,
    );
    const failedRuns = [...byDay.values()].reduce(
      (sum, value) => sum + value.failed,
      0,
    );
    await this.auditEvents.save(
      this.auditEvents.create({
        ...scope,
        action: 'telemetry_snapshot_collected',
        actorUserId: ctx.userId ?? null,
        noticeVersion: notice.version,
        noticeContentHash: notice.contentHash,
        details: {
          factsWritten: facts.length,
          terminalRuns,
          failedRuns,
        },
        occurredAt: new Date(),
      }),
    );

    return {
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      days: byDay.size,
      factsWritten: facts.length,
      terminalRuns,
      failedRuns,
    };
  }

  /**
   * Internal product-facing read model. It intentionally exposes no scope
   * pseudonym and suppresses every group below the k-anonymity floor.
   */
  async getProductAggregates(
    from: Date,
    to: Date,
  ): Promise<LeadFlowProductTelemetryAggregate[]> {
    const threshold = this.kAnonymityThreshold();
    const rows = await this.dataSource.query<
      Array<{
        observed_on: string;
        metric_key: string;
        dimension_key: string;
        metric_value: string;
        sample_size: string;
        contributing_scopes: string;
      }>
    >(
      `
        SELECT
          observed_on,
          metric_key,
          dimension_key,
          SUM(metric_value)::text AS metric_value,
          SUM(sample_size)::text AS sample_size,
          COUNT(DISTINCT scope_pseudonym)::text AS contributing_scopes
        FROM leadflow_product_telemetry_daily
        WHERE observed_on >= $1::date
          AND observed_on < $2::date
        GROUP BY observed_on, metric_key, dimension_key
        HAVING COUNT(DISTINCT scope_pseudonym) >= $3
        ORDER BY observed_on ASC, metric_key ASC, dimension_key ASC
      `,
      [from, to, threshold],
    );
    return rows.map((row) => ({
      observedOn: row.observed_on,
      metricKey: row.metric_key,
      dimensionKey: row.dimension_key,
      metricValue: row.metric_value,
      sampleSize: Number(row.sample_size),
      contributingScopes: Number(row.contributing_scopes),
    }));
  }

  @Interval('leadflow-telemetry-retention', RETENTION_INTERVAL_MS)
  async enforceRetention(): Promise<void> {
    if (!this.isCollectionEnabled() || this.retentionRunning) return;
    this.retentionRunning = true;
    try {
      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() - this.retentionDays());
      const deleted = await this.dailyFacts.delete({
        observedOn: LessThan(cutoff.toISOString().slice(0, 10)),
      });
      if (deleted.affected) {
        this.logger.log(
          `LeadFlow product telemetry retention removed ${deleted.affected} expired daily facts.`,
        );
      }
      await this.dataSource.query(
        `
          DELETE FROM leadflow_telemetry_identity_links identity_link
          WHERE identity_link.opted_out_at IS NOT NULL
            AND identity_link.opted_out_at < $1
            AND NOT EXISTS (
              SELECT 1
              FROM leadflow_product_telemetry_daily fact
              WHERE fact.scope_pseudonym = identity_link.scope_pseudonym
            )
        `,
        [cutoff],
      );
    } catch (error) {
      this.logger.warn(
        `LeadFlow telemetry retention failed: ${
          error instanceof Error ? error.message : 'unknown_error'
        }`,
      );
    } finally {
      this.retentionRunning = false;
    }
  }

  private async getCurrentNotice(purposeKey: string) {
    return this.notices.findOne({
      where: {
        purposeKey,
        locale: 'pt-BR',
        status: 'active',
      },
      order: { version: 'DESC', effectiveAt: 'DESC' },
    });
  }

  /**
   * Latest consent for this scope AND this purpose.
   *
   * The `purposeKey` filter is load-bearing, not defensive: the consent table
   * has no product column, so without it the newest row for the scope wins
   * regardless of which notice it documents. A scope holding only a legacy
   * `leadflow_product_improvement_v1` acceptance would then be reported as
   * consented for `platform_product_improvement_v1` — the silent promotion
   * D-4 and architecture §8.1 forbid. Each purpose keeps an independent
   * append-only history over the same rows.
   */
  private async findLatestConsent(
    repository: Repository<LeadFlowTelemetryConsentEntity>,
    scope: TelemetryScope,
    purposeKey: string,
  ) {
    return repository.findOne({
      where: { ...this.scopeWhere(scope), purposeKey },
      order: { occurredAt: 'DESC', createdAt: 'DESC' },
    });
  }

  /**
   * Read-only lookup of a *different* purpose's latest consent for the same
   * scope, used only so a product surface can honestly tell the user "there
   * is a previous acceptance of the LeadFlow notice" while still treating
   * the neutral purpose as not consented. It never feeds an authorization or
   * eligibility decision — see `getStatus`, where the neutral state is
   * derived exclusively from the neutral purpose's own rows.
   */
  async findRelatedPurposeConsent(
    ctx: RequestContext,
    purposeKey: string,
  ): Promise<{
    purposeKey: string;
    state: 'opted_in' | 'opted_out' | 'erased';
    occurredAt: string;
    noticeVersion: number | null;
  } | null> {
    const scope = this.resolveScope(ctx);
    const consent = await this.findLatestConsent(
      this.consents,
      scope,
      purposeKey,
    );

    if (!consent) return null;

    return {
      purposeKey: consent.purposeKey,
      state: consent.status,
      occurredAt: consent.occurredAt.toISOString(),
      noticeVersion: consent.noticeVersion,
    };
  }

  private async appendAudit(
    repository: Repository<LeadFlowTelemetryAuditEventEntity>,
    scope: TelemetryScope,
    actorUserId: string | undefined,
    action: string,
    notice: LeadFlowTelemetryConsentNoticeEntity | null,
    occurredAt: Date,
    details: Record<string, string | number | boolean | null>,
    consent?: LeadFlowTelemetryConsentEntity | null,
  ) {
    await repository.save(
      repository.create({
        ...scope,
        action,
        actorUserId: actorUserId ?? null,
        noticeVersion: notice?.version ?? consent?.noticeVersion ?? null,
        noticeContentHash:
          notice?.contentHash ?? consent?.noticeContentHash ?? null,
        details,
        occurredAt,
      }),
    );
  }

  private async queryAutomationRunCounts(
    scope: TelemetryScope,
    from: Date,
    to: Date,
  ): Promise<AutomationRunCountRow[]> {
    const clientFilter =
      scope.contextType === LeadFlowSettingsContextType.Client
        ? 'AND automation.agency_client_id = $5'
        : 'AND automation.agency_client_id IS NULL';
    const params =
      scope.contextType === LeadFlowSettingsContextType.Client
        ? [scope.tenantId, scope.workspaceId, from, to, scope.agencyClientId]
        : [scope.tenantId, scope.workspaceId, from, to];
    return this.dataSource.query<AutomationRunCountRow[]>(
      `
        SELECT
          (COALESCE(run.finished_at, run.created_at) AT TIME ZONE 'UTC')::date AS observed_on,
          run.status,
          COUNT(*)::text AS total
        FROM leadflow_automation_runs run
        INNER JOIN leadflow_automations automation
          ON automation.id = run.automation_id
         AND automation.tenant_id = run.tenant_id
         AND automation.workspace_id = run.workspace_id
        WHERE run.tenant_id = $1
          AND run.workspace_id = $2
          AND COALESCE(run.finished_at, run.created_at) >= $3
          AND COALESCE(run.finished_at, run.created_at) < $4
          AND run.mode = 'live'
          AND run.status IN ('succeeded', 'failed')
          AND automation.context_type = '${scope.contextType}'
          ${clientFilter}
        GROUP BY observed_on, run.status
        ORDER BY observed_on ASC, run.status ASC
      `,
      params,
    );
  }

  private resolveScope(ctx: RequestContext): TelemetryScope {
    if (!ctx.tenantId) {
      throw new BadRequestException('Tenant context is required.');
    }
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    const agencyClientId =
      ctx.managedContext?.operatingMode === 'client'
        ? ctx.managedContext.clientId
        : null;
    if (ctx.managedContext?.operatingMode === 'client' && !agencyClientId) {
      throw new BadRequestException('Managed client context is required.');
    }
    return {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      contextType: agencyClientId
        ? LeadFlowSettingsContextType.Client
        : LeadFlowSettingsContextType.Agency,
      agencyClientId,
    };
  }

  private scopeWhere<T extends { agencyClientId: string | null }>(
    scope: TelemetryScope,
  ): FindOptionsWhere<T> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      contextType: scope.contextType,
      agencyClientId: scope.agencyClientId ?? IsNull(),
    } as unknown as FindOptionsWhere<T>;
  }

  private identityWhere(
    scope: TelemetryScope,
  ): FindOptionsWhere<LeadFlowTelemetryIdentityLinkEntity> {
    return this.scopeWhere(scope);
  }

  private parseCollectionPeriod(dto: CollectLeadFlowTelemetryDto) {
    const from = new Date(dto.from);
    const to = new Date(dto.to);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
      throw new BadRequestException('Período de coleta inválido.');
    }
    if (from >= to) {
      throw new BadRequestException(
        'O início do período deve ser anterior ao fim.',
      );
    }
    if (to.getTime() - from.getTime() > MAX_COLLECTION_DAYS * 86_400_000) {
      throw new BadRequestException(
        `A coleta é limitada a ${MAX_COLLECTION_DAYS} dias por solicitação.`,
      );
    }
    if (to.getTime() > Date.now() + 60_000) {
      throw new BadRequestException('O período não pode terminar no futuro.');
    }
    return { from, to };
  }

  private toDateKey(value: string | Date) {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return value.slice(0, 10);
  }

  private isCollectionEnabled() {
    return process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED === 'true';
  }

  private retentionDays() {
    const parsed = Number(
      process.env.LEADFLOW_PRODUCT_TELEMETRY_RETENTION_DAYS ??
        DEFAULT_RETENTION_DAYS,
    );
    return Number.isInteger(parsed) && parsed >= 7 && parsed <= 365
      ? parsed
      : DEFAULT_RETENTION_DAYS;
  }

  private kAnonymityThreshold() {
    const parsed = Number(
      process.env.LEADFLOW_PRODUCT_TELEMETRY_K_ANONYMITY ?? MINIMUM_K_ANONYMITY,
    );
    return Number.isInteger(parsed) && parsed >= MINIMUM_K_ANONYMITY
      ? parsed
      : MINIMUM_K_ANONYMITY;
  }
}
