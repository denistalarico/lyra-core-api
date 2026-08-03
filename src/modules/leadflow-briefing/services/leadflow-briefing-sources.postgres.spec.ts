import { randomUUID } from 'node:crypto';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { LeadFlowBriefingSourceEntity, LeadFlowBriefingSourceVersionEntity } from '../entities';
import { LeadFlowBriefingSourceKind } from '../enums/leadflow-briefing-source-kind.enum';
import { LeadFlowBriefingSourceService } from './leadflow-briefing-source.service';

const run =
  process.env.INBOX_PG_INTEGRATION === 'true' ? describe : describe.skip;

run('LeadFlow Briefing sources PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  let service: LeadFlowBriefingSourceService;
  let settingsId: string;

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    service = new LeadFlowBriefingSourceService(AgencyDataSource);

    const settings = await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).save({
      tenantId,
      workspaceId,
      contextType: LeadFlowSettingsContextType.Agency,
      businessModeKey: LeadFlowBusinessMode.AgencyServices,
    });
    settingsId = settings.id;
  });

  afterAll(async () => {
    await AgencyDataSource.getRepository(LeadFlowBriefingSourceVersionEntity).delete({
      tenantId,
    });
    await AgencyDataSource.getRepository(LeadFlowBriefingSourceEntity).delete({ tenantId });
    await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).delete({ tenantId });
  });

  const ctx = () => ({ tenantId, workspaceId, userId: randomUUID() });

  it('creates two versions for a re-uploaded source (the "duas versões" scenario)', async () => {
    const source = await service.createSource(ctx(), {
      settingsId,
      contextType: LeadFlowSettingsContextType.Agency,
      agencyClientId: null,
      kind: LeadFlowBriefingSourceKind.Upload,
      label: 'Site institucional',
      createdById: null,
    });

    const v1 = await service.createSourceVersion(ctx(), {
      sourceId: source.id,
      kind: LeadFlowBriefingSourceKind.Upload,
      checksum: 'checksum-v1',
      createdById: null,
    });
    const v2 = await service.createSourceVersion(ctx(), {
      sourceId: source.id,
      kind: LeadFlowBriefingSourceKind.Upload,
      checksum: 'checksum-v2',
      createdById: null,
    });

    expect(v1.versionNumber).toBe(1);
    expect(v2.versionNumber).toBe(2);
  });

  it('treats a byte-identical re-upload as a no-op, not a new version', async () => {
    const source = await service.createSource(ctx(), {
      settingsId,
      contextType: LeadFlowSettingsContextType.Agency,
      agencyClientId: null,
      kind: LeadFlowBriefingSourceKind.Upload,
      label: 'PDF institucional',
      createdById: null,
    });

    const first = await service.createSourceVersion(ctx(), {
      sourceId: source.id,
      kind: LeadFlowBriefingSourceKind.Upload,
      checksum: 'same-checksum',
      createdById: null,
    });
    const second = await service.createSourceVersion(ctx(), {
      sourceId: source.id,
      kind: LeadFlowBriefingSourceKind.Upload,
      checksum: 'same-checksum',
      createdById: null,
    });

    expect(second.id).toBe(first.id);
    expect(second.versionNumber).toBe(1);
  });

  it('rejects a direct duplicate (source_id, version_number) insert at the DB level', async () => {
    const source = await service.createSource(ctx(), {
      settingsId,
      contextType: LeadFlowSettingsContextType.Agency,
      agencyClientId: null,
      kind: LeadFlowBriefingSourceKind.Upload,
      label: 'Duplicate version guard',
      createdById: null,
    });
    const repo = AgencyDataSource.getRepository(LeadFlowBriefingSourceVersionEntity);
    await repo.save(
      repo.create({ sourceId: source.id, tenantId, workspaceId, versionNumber: 1, kind: LeadFlowBriefingSourceKind.Upload }),
    );

    await expect(
      repo.save(
        repo.create({ sourceId: source.id, tenantId, workspaceId, versionNumber: 1, kind: LeadFlowBriefingSourceKind.Upload }),
      ),
    ).rejects.toThrow();
  });

  it('does not return a source created under a different tenant', async () => {
    const otherTenantId = randomUUID();
    const source = await service.createSource(
      { tenantId: otherTenantId, workspaceId, userId: randomUUID() },
      {
        settingsId,
        contextType: LeadFlowSettingsContextType.Agency,
        agencyClientId: null,
        kind: LeadFlowBriefingSourceKind.Upload,
        label: 'Other tenant source',
        createdById: null,
      },
    );

    const found = await AgencyDataSource.getRepository(LeadFlowBriefingSourceEntity).findOne({
      where: { id: source.id, tenantId },
    });
    expect(found).toBeNull();

    await AgencyDataSource.getRepository(LeadFlowBriefingSourceEntity).delete({
      tenantId: otherTenantId,
    });
  });

  it('does not return a source created under a different workspace in the same tenant', async () => {
    const otherWorkspaceId = randomUUID();
    const source = await service.createSource(
      { tenantId, workspaceId: otherWorkspaceId, userId: randomUUID() },
      {
        settingsId,
        contextType: LeadFlowSettingsContextType.Agency,
        agencyClientId: null,
        kind: LeadFlowBriefingSourceKind.Upload,
        label: 'Other workspace source',
        createdById: null,
      },
    );

    const found = await AgencyDataSource.getRepository(LeadFlowBriefingSourceEntity).findOne({
      where: { id: source.id, workspaceId },
    });
    expect(found).toBeNull();
  });
});
