import { SettingsCryptoService } from '../common/crypto/settings-crypto.service';
import { InboxChannelEntity } from '../modules/inbox/entities/inbox-channel.entity';
import {
  assertDatabaseTargets,
  buildReconciliationPlan,
  parseReconciliationOptions,
} from './reconcile-whatsapp-channel-datasource.lib';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const CHANNEL_ID = '33333333-3333-4333-8333-333333333333';

function options(overrides: Record<string, string> = {}) {
  return parseReconciliationOptions({
    RECONCILE_ENVIRONMENT: 'staging',
    RECONCILE_MODE: 'dry-run',
    RECONCILE_TENANT_ID: TENANT_ID,
    RECONCILE_WORKSPACE_ID: WORKSPACE_ID,
    RECONCILE_CHANNEL_ID: CHANNEL_ID,
    ...overrides,
  });
}

function channel(
  crypto: SettingsCryptoService,
  overrides: Partial<InboxChannelEntity> = {},
): InboxChannelEntity {
  return Object.assign(new InboxChannelEntity(), {
    id: CHANNEL_ID,
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    name: 'WhatsApp Test',
    type: 'whatsapp',
    status: 'active',
    provider: 'meta',
    externalId: 'phone-1',
    externalAccountId: 'waba-1',
    externalPhoneNumberId: 'phone-1',
    externalPageId: null,
    accessTokenEncrypted: crypto.encrypt('test-token'),
    verifyToken: null,
    webhookSecret: null,
    defaultAssignedUserId: null,
    defaultAgentId: null,
    aiEnabled: false,
    settings: { connectionHealth: 'connected' },
    metadata: { operatingMode: 'agency' },
    createdAt: new Date('2026-07-03T00:00:00.000Z'),
    updatedAt: new Date('2026-07-03T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  });
}

describe('WhatsApp channel datasource reconciliation', () => {
  const previousKey = process.env.SETTINGS_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.SETTINGS_ENCRYPTION_KEY = 'reconciliation-test-key';
  });

  afterAll(() => {
    if (previousKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = previousKey;
  });

  it('defaults to dry-run and blocks apply without its plan hash', () => {
    expect(options().mode).toBe('dry-run');
    expect(() => options({ RECONCILE_MODE: 'apply' })).toThrow(
      'apply_requires_reconcile_plan_hash_from_dry_run',
    );
  });

  it('blocks production by default and validates exact database pairs', () => {
    expect(() => options({ RECONCILE_ENVIRONMENT: 'production' })).toThrow(
      'production_reconciliation_is_blocked_by_default',
    );
    expect(() =>
      assertDatabaseTargets({
        environment: 'staging',
        sourceDatabase: 'lyra_core_staging',
        targetDatabase: 'lyra_core_staging',
      }),
    ).toThrow('reconciliation_database_target_mismatch');

    expect(() =>
      assertDatabaseTargets({
        environment: 'staging',
        sourceDatabase: 'lyra_core_staging_reconcile_test_a',
        targetDatabase: 'lyra_agency_staging_reconcile_test_b',
        allowCloneDatabases: true,
      }),
    ).toThrow('reconciliation_database_target_mismatch');

    expect(() =>
      assertDatabaseTargets({
        environment: 'staging',
        sourceDatabase: 'lyra_core_staging_reconcile_test_a',
        targetDatabase: 'lyra_agency_staging_reconcile_test_a',
        allowCloneDatabases: true,
      }),
    ).not.toThrow();
  });

  it('plans an insert, then becomes idempotent for an equivalent target', () => {
    const crypto = new SettingsCryptoService();
    const source = channel(crypto);
    const insert = buildReconciliationPlan({
      source,
      targetRows: [],
      options: options(),
      cryptoService: crypto,
    });
    expect(insert.action).toBe('insert');
    expect(insert.cryptoVerified).toBe(true);

    const target = channel(crypto);
    const secondRun = buildReconciliationPlan({
      source,
      targetRows: [target],
      options: options(),
      cryptoService: crypto,
    });
    expect(secondRun.action).toBe('noop');
  });

  it('reconciles a partial target without duplicating it', () => {
    const crypto = new SettingsCryptoService();
    const source = channel(crypto);
    const target = channel(crypto, {
      status: 'draft',
      externalAccountId: null,
      externalPhoneNumberId: null,
      accessTokenEncrypted: null,
      settings: {},
      metadata: {},
    });
    const plan = buildReconciliationPlan({
      source,
      targetRows: [target],
      options: options(),
      cryptoService: crypto,
    });
    expect(plan.action).toBe('update');
    expect(plan.targetExists).toBe(true);
  });

  it('rejects a conflicting target and a cross-workspace collision', () => {
    const crypto = new SettingsCryptoService();
    const source = channel(crypto);
    const conflictingTarget = channel(crypto, {
      externalAccountId: 'other-waba',
    });
    expect(() =>
      buildReconciliationPlan({
        source,
        targetRows: [conflictingTarget],
        options: options(),
        cryptoService: crypto,
      }),
    ).toThrow('target_waba_conflict');

    const crossWorkspace = channel(crypto, {
      id: '44444444-4444-4444-8444-444444444444',
      workspaceId: '55555555-5555-4555-8555-555555555555',
    });
    expect(() =>
      buildReconciliationPlan({
        source,
        targetRows: [crossWorkspace],
        options: options(),
        cryptoService: crypto,
      }),
    ).toThrow('target_phone_collision_requires_manual_resolution');
  });

  it('fails closed when source crypto is incompatible', () => {
    const crypto = new SettingsCryptoService();
    const source = channel(crypto, { accessTokenEncrypted: 'invalid' });
    expect(() =>
      buildReconciliationPlan({
        source,
        targetRows: [],
        options: options(),
        cryptoService: crypto,
      }),
    ).toThrow('source_access_token_cannot_be_decrypted');
  });
});
