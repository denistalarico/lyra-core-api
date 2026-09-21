import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { In, IsNull, Repository } from 'typeorm';
import { currentDayIn } from '../../social-integrations/sync/insights-window';
import {
  SocialAdAccountConnectionEntity,
  SocialAdEntity,
  SocialAdMetricDailyEntity,
} from '../../social-integrations/entities';
import type { UpdateSocialCampaignMonitorPolicyDto } from '../dto';
import {
  SocialCampaignAlertEntity,
  SocialCampaignMonitorPolicyEntity,
} from '../entities';
import {
  evaluateSocialCampaignMonitorRules,
  type SocialCampaignMonitorSnapshot,
} from './social-campaign-monitor-rules';
import type { SocialCampaignsScope } from './social-boost-template.service';

const META_PROVIDER = 'meta_ads';

type SpendRow = {
  daily_spend_minor: string | null;
  daily_rows: string;
  monthly_spend_minor: string | null;
  monthly_rows: string;
};

@Injectable()
export class SocialCampaignMonitorService {
  private readonly logger = new Logger(SocialCampaignMonitorService.name);

  constructor(
    @InjectRepository(SocialCampaignMonitorPolicyEntity, 'agency')
    private readonly policies: Repository<SocialCampaignMonitorPolicyEntity>,
    @InjectRepository(SocialCampaignAlertEntity, 'agency')
    private readonly alerts: Repository<SocialCampaignAlertEntity>,
    @InjectRepository(SocialAdAccountConnectionEntity, 'agency')
    private readonly connections: Repository<SocialAdAccountConnectionEntity>,
    @InjectRepository(SocialAdEntity, 'agency')
    private readonly entities: Repository<SocialAdEntity>,
    @InjectRepository(SocialAdMetricDailyEntity, 'agency')
    private readonly metrics: Repository<SocialAdMetricDailyEntity>,
  ) {}

  async overview(scope: SocialCampaignsScope, connectionId: string) {
    const connection = await this.requireConnection(scope, connectionId);
    const [policy, alerts, snapshot] = await Promise.all([
      this.findPolicy(scope, connectionId),
      this.alerts.find({
        where: {
          ...this.scopeWhere(scope, connectionId),
          status: In(['open', 'acknowledged']),
        },
        order: { lastTriggeredAt: 'DESC' },
        take: 50,
      }),
      this.readSnapshot(scope, connection),
    ]);

    return this.toOverview(connection, policy, alerts, snapshot);
  }

  async updatePolicy(
    scope: SocialCampaignsScope,
    userId: string | null,
    dto: UpdateSocialCampaignMonitorPolicyDto,
  ) {
    const connection = await this.requireConnection(scope, dto.connectionId);
    const current = await this.findPolicy(scope, connection.id);
    const values = {
      dailySpendLimitMinor: this.patchMinor(
        dto.dailySpendLimitMinor,
        current?.dailySpendLimitMinor ?? null,
      ),
      monthlySpendLimitMinor: this.patchMinor(
        dto.monthlySpendLimitMinor,
        current?.monthlySpendLimitMinor ?? null,
      ),
      balanceFloorMinor: this.patchMinor(
        dto.balanceFloorMinor,
        current?.balanceFloorMinor ?? null,
      ),
      deliveryChannels: [
        ...new Set(
          dto.deliveryChannels ?? current?.deliveryChannels ?? ['in_app'],
        ),
      ] as SocialCampaignMonitorPolicyEntity['deliveryChannels'],
      enabled: dto.enabled ?? current?.enabled ?? false,
      cooldownMinutes: dto.cooldownMinutes ?? current?.cooldownMinutes ?? 360,
    };

    if (!values.deliveryChannels.includes('in_app')) {
      throw new BadRequestException('In-app alerts must remain enabled.');
    }
    if (
      values.enabled &&
      values.dailySpendLimitMinor === null &&
      values.monthlySpendLimitMinor === null &&
      values.balanceFloorMinor === null
    ) {
      throw new BadRequestException('At least one monitor limit is required.');
    }

    const policy = this.policies.create({
      ...(current ?? {}),
      ...scope,
      connectionId: connection.id,
      ...values,
      createdById: current?.createdById ?? userId,
      updatedById: userId,
    });
    const saved = await this.policies.save(policy);
    await this.resolveAlertsDisabledBy(saved);
    return this.toPolicy(saved);
  }

  async evaluate(scope: SocialCampaignsScope, connectionId: string, now = new Date()) {
    const connection = await this.requireConnection(scope, connectionId);
    const policy = await this.findPolicy(scope, connection.id);
    if (!policy?.enabled) {
      throw new BadRequestException('Campaign monitor is not enabled.');
    }
    await this.evaluatePolicy(connection, policy, now);
    return this.overview(scope, connectionId);
  }

  async evaluateAll(now = new Date()): Promise<number> {
    const policies = await this.policies.find({ where: { enabled: true } });
    let evaluated = 0;
    for (const policy of policies) {
      try {
        const scope = {
          tenantId: policy.tenantId,
          workspaceId: policy.workspaceId,
          agencyClientId: policy.agencyClientId,
        };
        const connection = await this.connections.findOne({
          where: {
            id: policy.connectionId,
            ...this.baseScope(scope),
            provider: META_PROVIDER,
            connectionStatus: 'connected',
          },
        });
        if (!connection) continue;
        await this.evaluatePolicy(connection, policy, now);
        evaluated += 1;
      } catch (error) {
        this.logger.error(
          `Campaign monitor policy failed for ${policy.id}: ${error instanceof Error ? error.name : 'unknown'}`,
        );
      }
    }
    return evaluated;
  }

  async acknowledge(
    scope: SocialCampaignsScope,
    alertId: string,
    userId: string | null,
  ) {
    const alert = await this.alerts.findOne({
      where: { id: alertId, ...this.alertScope(scope) },
    });
    if (!alert) throw new NotFoundException('Campaign alert not found.');
    if (alert.status === 'resolved') return this.toAlert(alert);
    alert.status = 'acknowledged';
    alert.acknowledgedAt = new Date();
    alert.acknowledgedById = userId;
    return this.toAlert(await this.alerts.save(alert));
  }

  private async evaluatePolicy(
    connection: SocialAdAccountConnectionEntity,
    policy: SocialCampaignMonitorPolicyEntity,
    now: Date,
  ) {
    const scope = {
      tenantId: policy.tenantId,
      workspaceId: policy.workspaceId,
      agencyClientId: policy.agencyClientId,
    };
    const snapshot = await this.readSnapshot(scope, connection, now);
    const conditions = evaluateSocialCampaignMonitorRules(policy, snapshot);
    await this.resolveSupersededPeriods(policy, conditions, now);
    for (const condition of conditions) {
      await this.applyCondition(policy, connection, condition, now);
    }
  }

  private async resolveSupersededPeriods(
    policy: SocialCampaignMonitorPolicyEntity,
    conditions: ReturnType<typeof evaluateSocialCampaignMonitorRules>,
    now: Date,
  ) {
    const currentPeriods = new Map(
      conditions.map((condition) => [condition.type, condition.periodKey]),
    );
    const alerts = await this.alerts.find({
      where: {
        policyId: policy.id,
        tenantId: policy.tenantId,
        workspaceId: policy.workspaceId,
        agencyClientId:
          policy.agencyClientId === null ? IsNull() : policy.agencyClientId,
      },
    });
    const superseded = alerts.filter(
      (alert) =>
        alert.status !== 'resolved' &&
        alert.alertType !== 'low_balance' &&
        currentPeriods.get(alert.alertType) !== alert.periodKey,
    );
    for (const alert of superseded) {
      alert.status = 'resolved';
      alert.resolvedAt = now;
    }
    if (superseded.length) await this.alerts.save(superseded);
  }

  private async applyCondition(
    policy: SocialCampaignMonitorPolicyEntity,
    connection: SocialAdAccountConnectionEntity,
    condition: ReturnType<typeof evaluateSocialCampaignMonitorRules>[number],
    now: Date,
  ) {
    const deduplicationKey = createHash('sha256')
      .update(`${policy.id}:${condition.type}:${condition.periodKey}`)
      .digest('hex');
    const existing = await this.alerts.findOne({
      where: { deduplicationKey, policyId: policy.id },
    });

    if (!condition.triggered) {
      if (existing && existing.status !== 'resolved') {
        existing.status = 'resolved';
        existing.resolvedAt = now;
        existing.currentValueMinor = condition.currentValueMinor;
        existing.observedAt = connection.lastSyncedAt;
        await this.alerts.save(existing);
      }
      return;
    }

    if (!existing) {
      await this.alerts.save(
        this.alerts.create({
          tenantId: policy.tenantId,
          workspaceId: policy.workspaceId,
          agencyClientId: policy.agencyClientId,
          connectionId: policy.connectionId,
          policyId: policy.id,
          alertType: condition.type,
          status: 'open',
          currentValueMinor: condition.currentValueMinor,
          thresholdMinor: condition.thresholdMinor,
          currency: connection.currency ?? 'BRL',
          periodKey: condition.periodKey,
          deduplicationKey,
          occurrenceCount: 1,
          firstTriggeredAt: now,
          lastTriggeredAt: now,
          acknowledgedAt: null,
          acknowledgedById: null,
          resolvedAt: null,
          observedAt: connection.lastSyncedAt,
          metadata: { source: 'local_social_ads_read_model' },
        }),
      );
      return;
    }

    existing.currentValueMinor = condition.currentValueMinor;
    existing.thresholdMinor = condition.thresholdMinor;
    existing.observedAt = connection.lastSyncedAt;
    const cooldownAt = new Date(
      existing.lastTriggeredAt.getTime() + policy.cooldownMinutes * 60_000,
    );
    if (existing.status === 'resolved' || now >= cooldownAt) {
      const wasResolved = existing.status === 'resolved';
      existing.status = 'open';
      existing.lastTriggeredAt = now;
      existing.occurrenceCount += 1;
      existing.acknowledgedAt = null;
      existing.acknowledgedById = null;
      existing.resolvedAt = null;
      if (wasResolved) existing.firstTriggeredAt = now;
    }
    await this.alerts.save(existing);
  }

  private async resolveAlertsDisabledBy(policy: SocialCampaignMonitorPolicyEntity) {
    const activeTypes = new Set<string>();
    if (policy.enabled && policy.dailySpendLimitMinor !== null) {
      activeTypes.add('daily_spend_limit');
    }
    if (policy.enabled && policy.monthlySpendLimitMinor !== null) {
      activeTypes.add('monthly_spend_limit');
    }
    if (policy.enabled && policy.balanceFloorMinor !== null) {
      activeTypes.add('low_balance');
    }
    const current = await this.alerts.find({
      where: {
        policyId: policy.id,
        tenantId: policy.tenantId,
        workspaceId: policy.workspaceId,
        agencyClientId:
          policy.agencyClientId === null ? IsNull() : policy.agencyClientId,
      },
    });
    const now = new Date();
    const disabled = current.filter(
      (alert) => alert.status !== 'resolved' && !activeTypes.has(alert.alertType),
    );
    for (const alert of disabled) {
      alert.status = 'resolved';
      alert.resolvedAt = now;
    }
    if (disabled.length) await this.alerts.save(disabled);
  }

  private async readSnapshot(
    scope: SocialCampaignsScope,
    connection: SocialAdAccountConnectionEntity,
    now = new Date(),
  ): Promise<SocialCampaignMonitorSnapshot> {
    const day = currentDayIn(connection.timezone ?? '', now);
    const month = day.slice(0, 7);
    const monthStart = `${month}-01`;
    const spend = await this.metrics
      .createQueryBuilder('metric')
      .select(
        `ROUND(COALESCE(SUM(metric.spend) FILTER (WHERE metric.metric_date = :day), 0) * 100)::bigint`,
        'daily_spend_minor',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE metric.metric_date = :day)::text`,
        'daily_rows',
      )
      .addSelect(
        `ROUND(COALESCE(SUM(metric.spend) FILTER (WHERE metric.metric_date BETWEEN :monthStart AND :day), 0) * 100)::bigint`,
        'monthly_spend_minor',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE metric.metric_date BETWEEN :monthStart AND :day)::text`,
        'monthly_rows',
      )
      .where('metric.tenant_id = :tenantId', { tenantId: scope.tenantId })
      .andWhere('metric.workspace_id = :workspaceId', { workspaceId: scope.workspaceId })
      .andWhere('metric.agency_client_id IS NOT DISTINCT FROM :agencyClientId', {
        agencyClientId: scope.agencyClientId,
      })
      .andWhere('metric.connection_id = :connectionId', { connectionId: connection.id })
      .andWhere('metric.provider = :provider', { provider: META_PROVIDER })
      .andWhere('metric.entity_level = :level', { level: 'account' })
      .andWhere('metric.source = :source', { source: 'paid' })
      .andWhere('metric.attribution_setting = :attribution', {
        attribution: 'account_default',
      })
      .setParameters({ day, monthStart })
      .getRawOne<SpendRow>();

    const account = await this.entities.findOne({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
        connectionId: connection.id,
        provider: META_PROVIDER,
        entityLevel: 'account',
      },
      order: { lastSeenAt: 'DESC' },
    });

    return {
      day,
      month,
      dailySpendMinor: Number(spend?.daily_rows ?? 0) > 0 ? spend!.daily_spend_minor : null,
      monthlySpendMinor:
        Number(spend?.monthly_rows ?? 0) > 0 ? spend!.monthly_spend_minor : null,
      balanceMinor: account?.budgetRemainingMinor ?? null,
    };
  }

  private requireConnection(scope: SocialCampaignsScope, connectionId: string) {
    return this.connections
      .findOne({
        where: {
          id: connectionId,
          ...this.connectionScope(scope),
          provider: META_PROVIDER,
          connectionStatus: 'connected',
        },
      })
      .then((connection) => {
        if (!connection) throw new NotFoundException('Meta connection not found.');
        return connection;
      });
  }

  private findPolicy(scope: SocialCampaignsScope, connectionId: string) {
    return this.policies.findOne({
      where: { connectionId, ...this.alertScope(scope) },
    });
  }

  private connectionScope(scope: SocialCampaignsScope) {
    return {
      ...this.baseScope(scope),
      companyContextId:
        scope.companyContextId == null ? IsNull() : scope.companyContextId,
    };
  }

  private baseScope(scope: SocialCampaignsScope) {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }

  private alertScope(scope: SocialCampaignsScope) {
    return this.baseScope(scope);
  }

  private scopeWhere(scope: SocialCampaignsScope, connectionId: string) {
    return { connectionId, ...this.alertScope(scope) };
  }

  private patchMinor(value: number | null | undefined, fallback: string | null) {
    return value === undefined ? fallback : value === null ? null : String(value);
  }

  private toOverview(
    connection: SocialAdAccountConnectionEntity,
    policy: SocialCampaignMonitorPolicyEntity | null,
    alerts: SocialCampaignAlertEntity[],
    snapshot: SocialCampaignMonitorSnapshot,
  ) {
    return {
      connectionId: connection.id,
      accountName: connection.accountName,
      currency: connection.currency ?? 'BRL',
      timezone: connection.timezone,
      lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
      snapshot,
      policy: policy ? this.toPolicy(policy) : null,
      alerts: alerts.map((alert) => this.toAlert(alert)),
    };
  }

  private toPolicy(policy: SocialCampaignMonitorPolicyEntity) {
    return {
      id: policy.id,
      connectionId: policy.connectionId,
      enabled: policy.enabled,
      dailySpendLimitMinor: policy.dailySpendLimitMinor,
      monthlySpendLimitMinor: policy.monthlySpendLimitMinor,
      balanceFloorMinor: policy.balanceFloorMinor,
      cooldownMinutes: policy.cooldownMinutes,
      deliveryChannels: policy.deliveryChannels,
      channelAvailability: {
        in_app: 'active',
        email: 'adapter_pending',
        whatsapp: 'adapter_pending',
      },
      updatedAt: policy.updatedAt.toISOString(),
    };
  }

  private toAlert(alert: SocialCampaignAlertEntity) {
    return {
      id: alert.id,
      connectionId: alert.connectionId,
      type: alert.alertType,
      status: alert.status,
      currentValueMinor: alert.currentValueMinor,
      thresholdMinor: alert.thresholdMinor,
      currency: alert.currency,
      periodKey: alert.periodKey,
      occurrenceCount: alert.occurrenceCount,
      firstTriggeredAt: alert.firstTriggeredAt.toISOString(),
      lastTriggeredAt: alert.lastTriggeredAt.toISOString(),
      acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: alert.resolvedAt?.toISOString() ?? null,
      observedAt: alert.observedAt?.toISOString() ?? null,
    };
  }
}
