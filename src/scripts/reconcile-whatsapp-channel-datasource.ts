import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { SettingsCryptoService } from '../common/crypto/settings-crypto.service';
import { AgencyDataSource } from '../database/agency-typeorm.datasource';
import { AppDataSource } from '../database/typeorm.datasource';
import { InboxChannelEntity } from '../modules/inbox/entities/inbox-channel.entity';
import {
  assertDatabaseTargets,
  buildReconciliationPlan,
  parseReconciliationOptions,
  ReconciliationPlan,
} from './reconcile-whatsapp-channel-datasource.lib';

async function databaseName(dataSource: DataSource): Promise<string> {
  const [row] = await dataSource.query<Array<{ name: string }>>(
    'SELECT current_database() AS name',
  );
  if (!row?.name) throw new Error('database_name_could_not_be_resolved');
  return row.name;
}

async function loadSource(
  source: DataSource,
  input: { tenantId: string; workspaceId: string; channelId: string },
): Promise<InboxChannelEntity> {
  const channel = await source.getRepository(InboxChannelEntity).findOne({
    where: {
      id: input.channelId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
    },
  });
  if (!channel) throw new Error('source_channel_not_found');
  return channel;
}

async function loadTargetRows(
  target: DataSource,
  source: InboxChannelEntity,
): Promise<InboxChannelEntity[]> {
  return target
    .getRepository(InboxChannelEntity)
    .createQueryBuilder('channel')
    .withDeleted()
    .where('channel.id = :id', { id: source.id })
    .orWhere(
      'channel.external_phone_number_id = :phoneNumberId AND channel.deleted_at IS NULL',
      { phoneNumberId: source.externalPhoneNumberId },
    )
    .getMany();
}

function printPlan(plan: ReconciliationPlan, mode: string): void {
  console.log(
    JSON.stringify({
      event: 'whatsapp_channel_datasource_reconciliation',
      mode,
      action: plan.action,
      planHash: plan.planHash,
      channelRef: plan.channelRef,
      tenantRef: plan.tenantRef,
      workspaceRef: plan.workspaceRef,
      phoneRef: plan.phoneRef,
      wabaRef: plan.wabaRef,
      sourceStatus: plan.sourceStatus,
      targetStatus: plan.targetStatus,
      targetExists: plan.targetExists,
      cryptoVerified: plan.cryptoVerified,
      secretsExposed: false,
    }),
  );
}

async function applyPlan(input: {
  sourceChannel: InboxChannelEntity;
  targetDataSource: DataSource;
  expectedPlanHash: string;
  options: ReturnType<typeof parseReconciliationOptions>;
  cryptoService: SettingsCryptoService;
}): Promise<ReconciliationPlan> {
  const queryRunner = input.targetDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    await queryRunner.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `inbox-channel-reconcile:${input.sourceChannel.id}`,
    ]);

    const targetRepository =
      queryRunner.manager.getRepository(InboxChannelEntity);
    const targetRows = await targetRepository
      .createQueryBuilder('channel')
      .withDeleted()
      .where('channel.id = :id', { id: input.sourceChannel.id })
      .orWhere(
        'channel.external_phone_number_id = :phoneNumberId AND channel.deleted_at IS NULL',
        { phoneNumberId: input.sourceChannel.externalPhoneNumberId },
      )
      .getMany();

    const plan = buildReconciliationPlan({
      source: input.sourceChannel,
      targetRows,
      options: input.options,
      cryptoService: input.cryptoService,
    });

    if (plan.planHash !== input.expectedPlanHash) {
      throw new Error('reconciliation_plan_changed_since_dry_run');
    }

    if (plan.action !== 'noop') {
      const plaintext = input.cryptoService.decrypt(
        input.sourceChannel.accessTokenEncrypted,
      );
      if (!plaintext)
        throw new Error('source_access_token_cannot_be_decrypted');

      const existing = targetRows.find(
        (row) => row.id === input.sourceChannel.id,
      );
      const target =
        existing ??
        targetRepository.create({
          id: input.sourceChannel.id,
          tenantId: input.sourceChannel.tenantId,
          workspaceId: input.sourceChannel.workspaceId,
          type: 'whatsapp',
          provider: 'meta',
          verifyToken: null,
          webhookSecret: null,
          defaultAssignedUserId: null,
          defaultAgentId: null,
        });

      target.name = input.sourceChannel.name;
      target.status = input.sourceChannel.status;
      target.externalId = input.sourceChannel.externalId;
      target.externalAccountId = input.sourceChannel.externalAccountId;
      target.externalPhoneNumberId = input.sourceChannel.externalPhoneNumberId;
      target.externalPageId = input.sourceChannel.externalPageId;
      target.accessTokenEncrypted = input.cryptoService.encrypt(plaintext);
      target.aiEnabled = input.sourceChannel.aiEnabled;
      target.settings = input.sourceChannel.settings ?? {};
      target.metadata = input.sourceChannel.metadata ?? {};
      target.deletedAt = null;

      await targetRepository.save(target);
    }

    await queryRunner.commitTransaction();
    return plan;
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}

async function main(): Promise<void> {
  const options = parseReconciliationOptions(process.env);
  const cryptoService = new SettingsCryptoService();

  await AppDataSource.initialize();
  await AgencyDataSource.initialize();

  const [sourceDatabase, targetDatabase] = await Promise.all([
    databaseName(AppDataSource),
    databaseName(AgencyDataSource),
  ]);
  assertDatabaseTargets({
    environment: options.environment,
    sourceDatabase,
    targetDatabase,
    allowCloneDatabases: options.allowCloneDatabases,
  });

  const sourceChannel = await loadSource(AppDataSource, options);
  const targetRows = await loadTargetRows(AgencyDataSource, sourceChannel);
  const plan = buildReconciliationPlan({
    source: sourceChannel,
    targetRows,
    options,
    cryptoService,
  });

  if (options.mode === 'dry-run') {
    printPlan(plan, options.mode);
    return;
  }

  const applied = await applyPlan({
    sourceChannel,
    targetDataSource: AgencyDataSource,
    expectedPlanHash: options.expectedPlanHash!,
    options,
    cryptoService,
  });
  printPlan(applied, options.mode);
}

main()
  .catch((error: unknown) => {
    const candidate = error instanceof Error ? error.message : 'unknown_error';
    const code = /^[a-z0-9_]{3,100}$/.test(candidate)
      ? candidate
      : 'reconciliation_database_operation_failed';
    console.error(
      JSON.stringify({
        event: 'whatsapp_channel_datasource_reconciliation_failed',
        code,
        secretsExposed: false,
      }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });
