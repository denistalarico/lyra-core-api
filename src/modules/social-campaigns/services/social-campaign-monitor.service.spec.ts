import type { Repository } from 'typeorm';
import {
  SocialAdAccountConnectionEntity,
  SocialAdEntity,
  SocialAdMetricDailyEntity,
} from '../../social-integrations/entities';
import {
  SocialCampaignAlertEntity,
  SocialCampaignMonitorPolicyEntity,
} from '../entities';
import { SocialCampaignMonitorService } from './social-campaign-monitor.service';

function buildService() {
  const policies = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const alerts = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  const connections = { findOne: jest.fn() };
  const entities = { findOne: jest.fn() };
  const metrics = { createQueryBuilder: jest.fn() };
  return {
    alerts,
    entities,
    metrics,
    service: new SocialCampaignMonitorService(
      policies as unknown as Repository<SocialCampaignMonitorPolicyEntity>,
      alerts as unknown as Repository<SocialCampaignAlertEntity>,
      connections as unknown as Repository<SocialAdAccountConnectionEntity>,
      entities as unknown as Repository<SocialAdEntity>,
      metrics as unknown as Repository<SocialAdMetricDailyEntity>,
    ),
  };
}

const policy = {
  id: '00000000-0000-4000-8000-000000000010',
  tenantId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  agencyClientId: null,
  connectionId: '00000000-0000-4000-8000-000000000020',
  cooldownMinutes: 60,
} as SocialCampaignMonitorPolicyEntity;

const connection = {
  id: policy.connectionId,
  currency: 'BRL',
  lastSyncedAt: new Date('2026-09-15T09:55:00Z'),
} as SocialAdAccountConnectionEntity;

const triggered = {
  type: 'daily_spend_limit' as const,
  periodKey: '2026-09-15',
  currentValueMinor: '12000',
  thresholdMinor: '10000',
  triggered: true,
};

describe('SocialCampaignMonitorService alert lifecycle', () => {
  it('creates one local alert with a stable opaque deduplication key', async () => {
    const { alerts, service } = buildService();
    alerts.findOne.mockResolvedValue(null);

    await (service as any).applyCondition(
      policy,
      connection,
      triggered,
      new Date('2026-09-15T10:00:00Z'),
    );

    expect(alerts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        alertType: 'daily_spend_limit',
        periodKey: '2026-09-15',
        deduplicationKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        metadata: { source: 'local_social_ads_read_model' },
      }),
    );
  });

  it('updates evidence without incrementing inside the cooldown', async () => {
    const { alerts, service } = buildService();
    const existing = {
      status: 'open',
      occurrenceCount: 1,
      lastTriggeredAt: new Date('2026-09-15T10:00:00Z'),
    } as SocialCampaignAlertEntity;
    alerts.findOne.mockResolvedValue(existing);

    await (service as any).applyCondition(
      policy,
      connection,
      { ...triggered, currentValueMinor: '13000' },
      new Date('2026-09-15T10:30:00Z'),
    );

    expect(existing.currentValueMinor).toBe('13000');
    expect(existing.occurrenceCount).toBe(1);
    expect(existing.lastTriggeredAt.toISOString()).toBe(
      '2026-09-15T10:00:00.000Z',
    );
  });

  it('reopens and increments after the cooldown', async () => {
    const { alerts, service } = buildService();
    const existing = {
      status: 'acknowledged',
      occurrenceCount: 1,
      lastTriggeredAt: new Date('2026-09-15T10:00:00Z'),
      acknowledgedAt: new Date('2026-09-15T10:05:00Z'),
      acknowledgedById: '00000000-0000-4000-8000-000000000030',
    } as SocialCampaignAlertEntity;
    alerts.findOne.mockResolvedValue(existing);

    await (service as any).applyCondition(
      policy,
      connection,
      triggered,
      new Date('2026-09-15T11:01:00Z'),
    );

    expect(existing.status).toBe('open');
    expect(existing.occurrenceCount).toBe(2);
    expect(existing.acknowledgedAt).toBeNull();
  });

  it('resolves the current alert after recovery', async () => {
    const { alerts, service } = buildService();
    const existing = {
      status: 'open',
      occurrenceCount: 1,
      lastTriggeredAt: new Date('2026-09-15T10:00:00Z'),
    } as SocialCampaignAlertEntity;
    alerts.findOne.mockResolvedValue(existing);

    await (service as any).applyCondition(
      policy,
      connection,
      { ...triggered, currentValueMinor: '9000', triggered: false },
      new Date('2026-09-15T10:15:00Z'),
    );

    expect(existing.status).toBe('resolved');
    expect(existing.resolvedAt?.toISOString()).toBe('2026-09-15T10:15:00.000Z');
  });
});

describe('SocialCampaignMonitorService snapshot', () => {
  it('returns monthly Boost spend from observed campaign metrics', async () => {
    const { entities, metrics, service } = buildService();
    const query = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({
        daily_spend_minor: '1200',
        daily_rows: '1',
        monthly_spend_minor: '9000',
        monthly_rows: '3',
        monthly_boost_spend_minor: '3456',
        monthly_boost_rows: '2',
      }),
    };
    metrics.createQueryBuilder.mockReturnValue(query);
    entities.findOne.mockResolvedValue(null);

    const snapshot = await (
      service as unknown as {
        readSnapshot: (
          scope: {
            tenantId: string;
            workspaceId: string;
            agencyClientId: string | null;
          },
          connection: { id: string; timezone: string },
          now: Date,
        ) => Promise<{ monthlyBoostSpendMinor: string | null }>;
      }
    ).readSnapshot(
      {
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: null,
      },
      { id: 'connection-a', timezone: 'America/Sao_Paulo' },
      new Date('2026-11-09T12:00:00.000Z'),
    );

    expect(snapshot.monthlyBoostSpendMinor).toBe('3456');
    expect(query.addSelect.mock.calls.flat().join(' ')).toContain(
      'social_boost_requests',
    );
  });
});
