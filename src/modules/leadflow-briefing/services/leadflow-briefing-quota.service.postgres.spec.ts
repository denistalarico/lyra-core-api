import { randomUUID } from 'node:crypto';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { LeadFlowBriefingSourceEntity, LeadFlowBriefingSourceVersionEntity } from '../entities';
import { LeadFlowBriefingSourceKind } from '../enums/leadflow-briefing-source-kind.enum';
import { LeadFlowBriefingSourceVersionStatus } from '../enums/leadflow-briefing-source-version-status.enum';
import { LeadFlowBriefingQuotaService } from './leadflow-briefing-quota.service';
import { describePostgresIntegration } from '../../../testing/postgres-integration';

const run = describePostgresIntegration();

function fakeConfig(ceiling: number) {
  return {
    get: (key: string) =>
      key === 'leadflowBriefing.maxTotalBytesPerSettings' ? ceiling : undefined,
  } as never;
}

run('LeadFlowBriefingQuotaService PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  let settingsId: string;
  let otherSettingsId: string;
  let sourceId: string;

  const ctx = () => ({ tenantId, workspaceId, userId: randomUUID() });

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    const settings = await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).save({
      tenantId,
      workspaceId,
      contextType: LeadFlowSettingsContextType.Agency,
      businessModeKey: LeadFlowBusinessMode.AgencyServices,
    });
    settingsId = settings.id;

    const otherSettings = await AgencyDataSource.getRepository(
      LeadFlowClientSettingsEntity,
    ).save({
      tenantId,
      workspaceId,
      contextType: LeadFlowSettingsContextType.Agency,
      businessModeKey: LeadFlowBusinessMode.AgencyServices,
    });
    otherSettingsId = otherSettings.id;

    const source = await AgencyDataSource.getRepository(LeadFlowBriefingSourceEntity).save({
      tenantId,
      workspaceId,
      contextType: LeadFlowSettingsContextType.Agency,
      agencyClientId: null,
      settingsId,
      kind: LeadFlowBriefingSourceKind.Upload,
      label: 'Quota test source',
      createdById: null,
    });
    sourceId = source.id;

    await AgencyDataSource.getRepository(LeadFlowBriefingSourceVersionEntity).save({
      sourceId,
      tenantId,
      workspaceId,
      versionNumber: 1,
      kind: LeadFlowBriefingSourceKind.Upload,
      byteSize: '600',
      status: LeadFlowBriefingSourceVersionStatus.Available,
      checksum: 'quota-v1',
    });

    // A version for a DIFFERENT settingsId — must not count toward this settings' quota.
    const otherSource = await AgencyDataSource.getRepository(LeadFlowBriefingSourceEntity).save({
      tenantId,
      workspaceId,
      contextType: LeadFlowSettingsContextType.Agency,
      agencyClientId: null,
      settingsId: otherSettingsId,
      kind: LeadFlowBriefingSourceKind.Upload,
      label: 'Other settings source',
      createdById: null,
    });
    await AgencyDataSource.getRepository(LeadFlowBriefingSourceVersionEntity).save({
      sourceId: otherSource.id,
      tenantId,
      workspaceId,
      versionNumber: 1,
      kind: LeadFlowBriefingSourceKind.Upload,
      byteSize: '999999',
      status: LeadFlowBriefingSourceVersionStatus.Available,
      checksum: 'quota-other',
    });
  });

  afterAll(async () => {
    await AgencyDataSource.getRepository(LeadFlowBriefingSourceVersionEntity).delete({
      tenantId,
    });
    await AgencyDataSource.getRepository(LeadFlowBriefingSourceEntity).delete({ tenantId });
    await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).delete({ tenantId });
  });

  it('allows content that stays under the ceiling', async () => {
    const service = new LeadFlowBriefingQuotaService(AgencyDataSource, fakeConfig(1000));
    await expect(service.assertWithinQuota(ctx(), settingsId, 300)).resolves.toBeUndefined();
  });

  it('rejects content that would cross the ceiling', async () => {
    const service = new LeadFlowBriefingQuotaService(AgencyDataSource, fakeConfig(1000));
    await expect(service.assertWithinQuota(ctx(), settingsId, 500)).rejects.toThrow(
      /storage quota/,
    );
  });

  it('scopes the quota per settingsId — another settings usage does not count', async () => {
    // otherSettingsId already has 999999 bytes recorded, but a low ceiling
    // here should still allow settingsId (only 600 bytes used) through.
    const service = new LeadFlowBriefingQuotaService(AgencyDataSource, fakeConfig(1000));
    await expect(service.assertWithinQuota(ctx(), settingsId, 300)).resolves.toBeUndefined();
  });
});
