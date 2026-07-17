import { createHash } from 'crypto';
import { SettingsCryptoService } from '../common/crypto/settings-crypto.service';
import { InboxChannelEntity } from '../modules/inbox/entities/inbox-channel.entity';

export type ReconciliationMode = 'dry-run' | 'apply';

export type ReconciliationOptions = {
  environment: 'staging' | 'production';
  mode: ReconciliationMode;
  tenantId: string;
  workspaceId: string;
  channelId: string;
  expectedPlanHash: string | null;
  allowProduction: boolean;
  allowCloneDatabases: boolean;
};

export type ReconciliationAction = 'insert' | 'update' | 'noop';

export type ReconciliationPlan = {
  action: ReconciliationAction;
  planHash: string;
  channelRef: string;
  tenantRef: string;
  workspaceRef: string;
  phoneRef: string;
  wabaRef: string;
  sourceStatus: string;
  targetStatus: string | null;
  targetExists: boolean;
  cryptoVerified: true;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredUuid(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value || !UUID_PATTERN.test(value)) {
    throw new Error(`${name.toLowerCase()}_must_be_uuid`);
  }
  return value;
}

export function parseReconciliationOptions(
  env: NodeJS.ProcessEnv,
): ReconciliationOptions {
  const environment = env.RECONCILE_ENVIRONMENT?.trim();
  if (environment !== 'staging' && environment !== 'production') {
    throw new Error('reconcile_environment_must_be_staging_or_production');
  }

  const mode = env.RECONCILE_MODE?.trim() || 'dry-run';
  if (mode !== 'dry-run' && mode !== 'apply') {
    throw new Error('reconcile_mode_must_be_dry_run_or_apply');
  }

  const allowProduction = env.RECONCILE_ALLOW_PRODUCTION === 'true';
  const allowCloneDatabases = env.RECONCILE_ALLOW_CLONE_DATABASES === 'true';
  if (environment === 'production' && !allowProduction) {
    throw new Error('production_reconciliation_is_blocked_by_default');
  }

  const expectedPlanHash = env.RECONCILE_PLAN_HASH?.trim() || null;
  if (mode === 'apply' && !expectedPlanHash) {
    throw new Error('apply_requires_reconcile_plan_hash_from_dry_run');
  }

  return {
    environment,
    mode,
    tenantId: requiredUuid(env, 'RECONCILE_TENANT_ID'),
    workspaceId: requiredUuid(env, 'RECONCILE_WORKSPACE_ID'),
    channelId: requiredUuid(env, 'RECONCILE_CHANNEL_ID'),
    expectedPlanHash,
    allowProduction,
    allowCloneDatabases,
  };
}

export function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

function serialized(value: unknown): string {
  return JSON.stringify(stable(value));
}

function channelFingerprint(channel: InboxChannelEntity | null): unknown {
  if (!channel) return null;
  return {
    id: channel.id,
    tenantId: channel.tenantId,
    workspaceId: channel.workspaceId,
    name: channel.name,
    type: channel.type,
    status: channel.status,
    provider: channel.provider,
    externalId: channel.externalId,
    externalAccountId: channel.externalAccountId,
    externalPhoneNumberId: channel.externalPhoneNumberId,
    externalPageId: channel.externalPageId,
    accessTokenFingerprint: channel.accessTokenEncrypted
      ? shortHash(channel.accessTokenEncrypted)
      : null,
    aiEnabled: channel.aiEnabled,
    settings: channel.settings ?? {},
    metadata: channel.metadata ?? {},
    deleted: Boolean(channel.deletedAt),
  };
}

function assertSource(
  source: InboxChannelEntity,
  options: ReconciliationOptions,
): void {
  if (
    source.id !== options.channelId ||
    source.tenantId !== options.tenantId ||
    source.workspaceId !== options.workspaceId
  ) {
    throw new Error('source_scope_mismatch');
  }
  if (source.type !== 'whatsapp' || source.provider !== 'meta') {
    throw new Error('source_is_not_meta_whatsapp');
  }
  if (source.deletedAt || source.status !== 'active') {
    throw new Error('source_channel_is_not_active');
  }
  if (!source.externalPhoneNumberId || !source.externalAccountId) {
    throw new Error('source_external_identity_is_incomplete');
  }
  if (!source.accessTokenEncrypted) {
    throw new Error('source_access_token_is_missing');
  }
  if (source.defaultAssignedUserId || source.defaultAgentId) {
    throw new Error('source_has_unmigrated_channel_dependencies');
  }
}

function decryptRequired(
  cryptoService: SettingsCryptoService,
  ciphertext: string,
  errorCode: string,
): string {
  try {
    const plaintext = cryptoService.decrypt(ciphertext);
    if (!plaintext) throw new Error(errorCode);
    return plaintext;
  } catch {
    throw new Error(errorCode);
  }
}

function assertCompatibleTarget(
  source: InboxChannelEntity,
  target: InboxChannelEntity,
  cryptoService: SettingsCryptoService,
  sourcePlaintext: string,
): void {
  if (target.deletedAt) throw new Error('target_channel_is_soft_deleted');
  if (
    target.tenantId !== source.tenantId ||
    target.workspaceId !== source.workspaceId
  ) {
    throw new Error('target_scope_conflict');
  }
  if (target.type !== 'whatsapp' || target.provider !== 'meta') {
    throw new Error('target_provider_conflict');
  }

  for (const [name, sourceValue, targetValue] of [
    ['phone', source.externalPhoneNumberId, target.externalPhoneNumberId],
    ['waba', source.externalAccountId, target.externalAccountId],
    ['external_id', source.externalId, target.externalId],
  ] as const) {
    if (targetValue && sourceValue && targetValue !== sourceValue) {
      throw new Error(`target_${name}_conflict`);
    }
  }

  if (target.accessTokenEncrypted) {
    const targetPlaintext = decryptRequired(
      cryptoService,
      target.accessTokenEncrypted,
      'target_access_token_cannot_be_decrypted',
    );
    if (targetPlaintext !== sourcePlaintext) {
      throw new Error('target_access_token_conflict');
    }
  }
}

function needsUpdate(
  source: InboxChannelEntity,
  target: InboxChannelEntity,
): boolean {
  return (
    source.name !== target.name ||
    source.status !== target.status ||
    source.externalId !== target.externalId ||
    source.externalAccountId !== target.externalAccountId ||
    source.externalPhoneNumberId !== target.externalPhoneNumberId ||
    source.externalPageId !== target.externalPageId ||
    !target.accessTokenEncrypted ||
    source.aiEnabled !== target.aiEnabled ||
    serialized(source.settings ?? {}) !== serialized(target.settings ?? {}) ||
    serialized(source.metadata ?? {}) !== serialized(target.metadata ?? {})
  );
}

export function buildReconciliationPlan(input: {
  source: InboxChannelEntity;
  targetRows: InboxChannelEntity[];
  options: ReconciliationOptions;
  cryptoService: SettingsCryptoService;
}): ReconciliationPlan {
  const { source, targetRows, options, cryptoService } = input;
  assertSource(source, options);

  const sourcePlaintext = decryptRequired(
    cryptoService,
    source.accessTokenEncrypted!,
    'source_access_token_cannot_be_decrypted',
  );

  const targetById = targetRows.filter((row) => row.id === source.id);
  if (targetById.length > 1) throw new Error('target_id_is_not_unique');

  const phoneCollisions = targetRows.filter(
    (row) =>
      !row.deletedAt &&
      row.id !== source.id &&
      row.externalPhoneNumberId === source.externalPhoneNumberId,
  );
  if (phoneCollisions.length) {
    throw new Error('target_phone_collision_requires_manual_resolution');
  }

  const target = targetById[0] ?? null;
  if (target) {
    assertCompatibleTarget(source, target, cryptoService, sourcePlaintext);
  }

  const action: ReconciliationAction = !target
    ? 'insert'
    : needsUpdate(source, target)
      ? 'update'
      : 'noop';

  const planHash = createHash('sha256')
    .update(
      serialized({
        version: 1,
        environment: options.environment,
        action,
        source: channelFingerprint(source),
        target: channelFingerprint(target),
      }),
    )
    .digest('hex');

  return {
    action,
    planHash,
    channelRef: shortHash(source.id),
    tenantRef: shortHash(source.tenantId),
    workspaceRef: shortHash(source.workspaceId),
    phoneRef: shortHash(source.externalPhoneNumberId!),
    wabaRef: shortHash(source.externalAccountId!),
    sourceStatus: source.status,
    targetStatus: target?.status ?? null,
    targetExists: Boolean(target),
    cryptoVerified: true,
  };
}

export function assertDatabaseTargets(input: {
  environment: ReconciliationOptions['environment'];
  sourceDatabase: string;
  targetDatabase: string;
  allowCloneDatabases?: boolean;
}): void {
  const expected =
    input.environment === 'staging'
      ? {
          source: 'lyra_core_staging',
          target: 'lyra_agency_staging',
        }
      : { source: 'lyra_core', target: 'lyra_agency' };

  const exactPair =
    input.sourceDatabase === expected.source &&
    input.targetDatabase === expected.target;
  const sourceClonePrefix = `${expected.source}_reconcile_test_`;
  const targetClonePrefix = `${expected.target}_reconcile_test_`;
  const clonePair =
    Boolean(input.allowCloneDatabases) &&
    input.sourceDatabase.startsWith(sourceClonePrefix) &&
    input.targetDatabase.startsWith(targetClonePrefix) &&
    input.sourceDatabase.slice(sourceClonePrefix.length) ===
      input.targetDatabase.slice(targetClonePrefix.length) &&
    input.sourceDatabase.length > sourceClonePrefix.length;

  if (
    (!exactPair && !clonePair) ||
    input.sourceDatabase === input.targetDatabase
  ) {
    throw new Error('reconciliation_database_target_mismatch');
  }
}
