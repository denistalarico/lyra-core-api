import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { GoogleAdsMutationError } from '../../social-integrations/services/google-ads-mutation.client';
import type { GoogleAdWritableState } from './google-ads-manual-action.adapter';
import { SocialAdManualActionService } from './social-ad-manual-action.service';

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  agencyClientId: null,
  companyContextId: null,
};
const CONNECTION = '33333333-3333-4333-8333-333333333333';
const BUDGET = 'customers/1234567890/campaignBudgets/31';

const empty: GoogleAdWritableState = {
  status: null,
  budget: null,
  criterionResourceName: null,
};

type Options = {
  googleBrake?: boolean;
  policy?: Record<string, unknown> | null;
  entity?: Record<string, unknown> | null;
  parentCampaign?: Record<string, unknown> | null;
  connectionProvider?: string;
};

function setup(options: Options = {}) {
  const policy =
    options.policy === null
      ? null
      : {
          enabled: true,
          allowStatus: true,
          allowBudget: true,
          allowSchedule: true,
          allowDelete: true,
          allowBoost: false,
          allowKeywords: true,
          maxBudgetMinor: null,
          maxBudgetIncreasePercent: 25,
          confirmationTtlMinutes: 10,
          ...options.policy,
        };
  const entity =
    options.entity === null
      ? null
      : {
          connectionId: CONNECTION,
          entityLevel: 'campaign',
          externalId: '24460619718',
          name: 'Campanha fictícia',
          parentExternalId: '1234567890',
          campaignExternalId: '24460619718',
          archivedAt: null,
          status: 'ACTIVE',
          dailyBudgetMinor: '5000',
          lifetimeBudgetMinor: null,
          stopTime: null,
          metadata: { channelType: 'PERFORMANCE_MAX' },
          ...options.entity,
        };

  const saved: Array<Record<string, unknown>> = [];
  const actions = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((row: Record<string, unknown>) => ({ ...row })),
    save: jest.fn((row: Record<string, unknown>) => {
      saved.push({ ...row });
      return Promise.resolve({ id: 'a1', createdAt: new Date(), ...row });
    }),
    find: jest.fn().mockResolvedValue([]),
  };
  const policies = {
    findOne: jest.fn().mockResolvedValue(policy),
    create: jest.fn((row: Record<string, unknown>) => ({ ...row })),
    save: jest.fn((row: Record<string, unknown>) => Promise.resolve(row)),
  };
  const connections = {
    findOne: jest.fn(({ where }: { where: { provider: string } }) =>
      Promise.resolve(
        where.provider === (options.connectionProvider ?? 'google_ads')
          ? { id: CONNECTION, provider: where.provider }
          : null,
      ),
    ),
  };
  const entities = {
    findOne: jest.fn(({ where }: { where: { entityLevel: string } }) =>
      Promise.resolve(
        where.entityLevel === 'campaign' && entity?.entityLevel !== 'campaign'
          ? (options.parentCampaign ?? null)
          : entity,
      ),
    ),
  };
  let locked: Record<string, unknown> | null = null;
  const manager = {
    getRepository: () => ({
      createQueryBuilder: () => ({
        setLock: () => ({
          where: () => ({ getOne: () => Promise.resolve(locked) }),
        }),
      }),
      save: (row: Record<string, unknown>) => Promise.resolve(row),
    }),
  };
  const dataSource = {
    transaction: jest.fn((run: (m: typeof manager) => unknown) => run(manager)),
  };
  const config = {
    writesEnabled: true,
    writesEnabledFor: (provider: string) =>
      provider === 'google_ads' ? (options.googleBrake ?? true) : true,
  };
  const meta = { execute: jest.fn() };
  const google = {
    inspect: jest.fn(),
    validate: jest.fn().mockResolvedValue(undefined),
    execute: jest.fn(),
  };
  const service = new SocialAdManualActionService(
    policies as never,
    actions as never,
    connections as never,
    entities as never,
    dataSource as never,
    config as never,
    meta as never,
    google as never,
  );
  return {
    service,
    google,
    meta,
    saved,
    connections,
    policies,
    setLocked: (row: Record<string, unknown>) => {
      locked = row;
    },
  };
}

const dto = (extra: Record<string, unknown> = {}) =>
  ({
    connectionId: CONNECTION,
    entityLevel: 'campaign',
    entityExternalId: '24460619718',
    requestId: '44444444-4444-4444-8444-444444444444',
    ...extra,
  }) as never;

describe('SocialAdManualActionService on Google (GA-WRITE)', () => {
  it('refuses everything while the Google brake is off, without calling Google', async () => {
    const { service, google } = setup({ googleBrake: false });
    await expect(
      service.preflight(
        scope,
        'u1',
        'set_status',
        dto({ status: 'PAUSED' }),
        'google_ads',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(google.inspect).not.toHaveBeenCalled();
  });

  it('does not let a Meta route reach a Google connection', async () => {
    const { service, connections } = setup();
    await expect(
      service.preflight(scope, 'u1', 'set_status', dto({ status: 'PAUSED' })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(connections.findOne.mock.calls[0][0].where.provider).toBe(
      'meta_ads',
    );
  });

  it('offers no schedule or delete on Google', async () => {
    const { service } = setup();
    for (const type of ['set_end_time', 'delete'] as const) {
      await expect(
        service.preflight(scope, 'u1', type, dto(), 'google_ads'),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('needs allow_keywords for keyword actions', async () => {
    const { service, google } = setup({ policy: { allowKeywords: false } });
    await expect(
      service.preflight(
        scope,
        'u1',
        'negative_keyword',
        dto({ payload: { op: 'add', text: 'grátis', matchType: 'PHRASE' } }),
        'google_ads',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(google.inspect).not.toHaveBeenCalled();
  });

  it('stores the live state and runs validateOnly before asking for confirmation', async () => {
    const { service, google, saved } = setup({
      entity: {
        entityLevel: 'adset',
        externalId: '9',
        metadata: { googleKind: 'asset_group' },
      },
    });
    const live = { ...empty, status: 'ENABLED' };
    google.inspect.mockResolvedValue(live);
    const view = await service.preflight(
      scope,
      'u1',
      'set_status',
      dto({ entityLevel: 'adset', entityExternalId: '9', status: 'PAUSED' }),
      'google_ads',
    );

    expect(google.validate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: 'asset_group', id: '9', adGroupId: null },
        expected: live,
      }),
    );
    expect(view.status).toBe('pending_confirmation');
    expect(saved[0].beforeSnapshot).toEqual(live);
  });

  it('refuses a shared budget with a message', async () => {
    const { service, google } = setup();
    google.inspect.mockResolvedValue({
      ...empty,
      budget: {
        resourceName: BUDGET,
        amountMinor: '5000',
        period: 'DAILY',
        shared: true,
      },
    });
    const error = await service
      .preflight(
        scope,
        'u1',
        'set_budget',
        dto({ budgetKind: 'daily', budgetAmountMinor: 5100 }),
        'google_ads',
      )
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject(
      {
        code: 'google_budget_shared',
      },
    );
    expect(google.validate).not.toHaveBeenCalled();
  });

  it('applies the policy limits to the live Google budget', async () => {
    const { service, google } = setup({
      policy: { maxBudgetIncreasePercent: 10 },
    });
    google.inspect.mockResolvedValue({
      ...empty,
      budget: {
        resourceName: BUDGET,
        amountMinor: '5000',
        period: 'DAILY',
        shared: false,
      },
    });
    await expect(
      service.preflight(
        scope,
        'u1',
        'set_budget',
        dto({ budgetKind: 'daily', budgetAmountMinor: 5600 }),
        'google_ads',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(google.validate).not.toHaveBeenCalled();
  });

  it('accepts +R$ 1 on a R$ 50 daily budget under the default policy', async () => {
    const { service, google } = setup();
    google.inspect.mockResolvedValue({
      ...empty,
      budget: {
        resourceName: BUDGET,
        amountMinor: '5000',
        period: 'DAILY',
        shared: false,
      },
    });
    const view = await service.preflight(
      scope,
      'u1',
      'set_budget',
      dto({ budgetKind: 'daily', budgetAmountMinor: 5100 }),
      'google_ads',
    );
    expect(view.requestedChange).toMatchObject({ budgetAmountMinor: 5100 });
    expect(google.validate).toHaveBeenCalled();
  });

  it('allows keywords only on Search ad groups', async () => {
    const { service } = setup({
      entity: {
        entityLevel: 'adset',
        externalId: '55',
        metadata: {},
        parentExternalId: '24460619718',
      },
      parentCampaign: { metadata: { channelType: 'PERFORMANCE_MAX' } },
    });
    await expect(
      service.preflight(
        scope,
        'u1',
        'keyword',
        dto({
          entityLevel: 'adset',
          entityExternalId: '55',
          payload: { op: 'add', text: 'curso online', matchType: 'EXACT' },
        }),
        'google_ads',
      ),
    ).rejects.toThrow('Keywords can only be changed on Search campaigns.');
  });

  it('refuses adding a keyword that already exists', async () => {
    const { service, google } = setup();
    google.inspect.mockResolvedValue({
      ...empty,
      criterionResourceName:
        'customers/1234567890/campaignCriteria/24460619718~5',
    });
    await expect(
      service.preflight(
        scope,
        'u1',
        'negative_keyword',
        dto({ payload: { op: 'add', text: 'grátis', matchType: 'PHRASE' } }),
        'google_ads',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns a Google refusal in the preflight as a code and its enum', async () => {
    const { service, google } = setup();
    google.inspect.mockResolvedValue({ ...empty, status: 'ENABLED' });
    google.validate.mockRejectedValue(
      new GoogleAdsMutationError(
        'permanent',
        'google_ads_bad_request',
        'OPERATION_NOT_PERMITTED_FOR_CONTEXT',
      ),
    );
    const error = await service
      .preflight(
        scope,
        'u1',
        'set_status',
        dto({ status: 'PAUSED' }),
        'google_ads',
      )
      .catch((caught: unknown) => caught);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject(
      {
        code: 'google_ads_bad_request',
        reason: 'OPERATION_NOT_PERMITTED_FOR_CONTEXT',
      },
    );
  });

  describe('confirm', () => {
    const pending = () => ({
      id: 'a1',
      ...scope,
      connectionId: CONNECTION,
      entityLevel: 'campaign',
      entityExternalId: '24460619718',
      actionType: 'set_status',
      status: 'pending_confirmation',
      confirmationRequestId: null,
      confirmationPhrase: null,
      expiresAt: new Date(Date.now() + 60_000),
      beforeSnapshot: { ...empty, status: 'ENABLED' },
      requestedChange: {
        status: 'PAUSED',
        target: { kind: 'campaign', id: '24460619718', adGroupId: null },
      },
      createdAt: new Date(),
    });

    it('executes through the Google adapter and records verification', async () => {
      const { service, google, meta, setLocked } = setup();
      setLocked(pending());
      google.execute.mockResolvedValue({
        before: { ...empty, status: 'ENABLED' },
        after: { ...empty, status: 'PAUSED' },
        providerAccepted: true,
        verified: true,
      });
      const view = await service.confirm(
        scope,
        'u1',
        'set_status',
        'a1',
        '55555555-5555-4555-8555-555555555555',
        undefined,
        'google_ads',
      );
      expect(meta.execute).not.toHaveBeenCalled();
      expect(google.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { kind: 'campaign', id: '24460619718', adGroupId: null },
          expected: { ...empty, status: 'ENABLED' },
        }),
      );
      expect(view.status).toBe('verified');
    });

    it('records a Google refusal as failed with code and enum', async () => {
      const { service, google, setLocked } = setup();
      setLocked(pending());
      google.execute.mockRejectedValue(
        new GoogleAdsMutationError(
          'permanent',
          'google_ads_bad_request',
          'RESOURCE_NOT_FOUND',
        ),
      );
      const view = await service.confirm(
        scope,
        'u1',
        'set_status',
        'a1',
        '55555555-5555-4555-8555-555555555555',
        undefined,
        'google_ads',
      );
      expect(view.status).toBe('failed');
      expect(view.errorCode).toBe('google_ads_bad_request:RESOURCE_NOT_FOUND');
    });

    it('refuses to confirm while the Google brake is off', async () => {
      const { service, google, setLocked } = setup({ googleBrake: false });
      setLocked(pending());
      await expect(
        service.confirm(
          scope,
          'u1',
          'set_status',
          'a1',
          '55555555-5555-4555-8555-555555555555',
          undefined,
          'google_ads',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(google.execute).not.toHaveBeenCalled();
    });
  });

  describe('policy', () => {
    const body = {
      connectionId: CONNECTION,
      enabled: true,
      allowStatus: true,
      allowBudget: true,
      allowSchedule: true,
      allowDelete: true,
      allowBoost: true,
      allowKeywords: true,
      maxBudgetMinor: null,
      maxBudgetIncreasePercent: 25,
      confirmationTtlMinutes: 10,
    };

    it('never stores schedule, delete or boost for Google', async () => {
      const { service, policies } = setup({ policy: null });
      const view = await service.updatePolicy(scope, 'u1', body, 'google_ads');
      expect(policies.save.mock.calls[0][0]).toMatchObject({
        allowSchedule: false,
        allowDelete: false,
        allowBoost: false,
        allowKeywords: true,
      });
      expect(view).toMatchObject({
        provider: 'google_ads',
        allowKeywords: true,
      });
    });

    it('never stores allow_keywords for Meta', async () => {
      const { service, policies } = setup({
        policy: null,
        connectionProvider: 'meta_ads',
      });
      await service.updatePolicy(scope, 'u1', body);
      expect(policies.save.mock.calls[0][0]).toMatchObject({
        allowKeywords: false,
      });
    });
  });
});
