import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { LeadFlowBriefingSourceEntity, LeadFlowBriefingSourceVersionEntity } from '../entities';
import { LeadFlowBriefingSourceKind } from '../enums/leadflow-briefing-source-kind.enum';
import { LeadFlowBriefingSourceVersionStatus } from '../enums/leadflow-briefing-source-version-status.enum';
import { LeadFlowBriefingContentService } from './leadflow-briefing-content.service';
import { describePostgresIntegration } from '../../../testing/postgres-integration';

const run = describePostgresIntegration();

function fakeFilesService() {
  return {
    getPrivateAsset: async (path: string) => ({
      body: Readable.from([Buffer.from(`content-of:${path}`)]),
      contentType: 'application/pdf',
      cacheControl: 'private, no-store',
    }),
  };
}

run('LeadFlowBriefingContentService PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  let settingsId: string;
  let sourceId: string;
  let objectVersionId: string;
  let textVersionId: string;

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    const settings = await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).save({
      tenantId,
      workspaceId,
      contextType: LeadFlowSettingsContextType.Agency,
      businessModeKey: LeadFlowBusinessMode.AgencyServices,
    });
    settingsId = settings.id;

    const source = await AgencyDataSource.getRepository(LeadFlowBriefingSourceEntity).save({
      tenantId,
      workspaceId,
      contextType: LeadFlowSettingsContextType.Agency,
      agencyClientId: null,
      settingsId,
      kind: LeadFlowBriefingSourceKind.Upload,
      label: 'Content test source',
      createdById: null,
    });
    sourceId = source.id;

    const objectVersion = await AgencyDataSource.getRepository(
      LeadFlowBriefingSourceVersionEntity,
    ).save({
      sourceId,
      tenantId,
      workspaceId,
      versionNumber: 1,
      kind: LeadFlowBriefingSourceKind.Upload,
      objectKey: `tenants/${tenantId}/workspaces/${workspaceId}/leadflow-briefing/${sourceId}/v1`,
      status: LeadFlowBriefingSourceVersionStatus.Available,
      checksum: 'content-v1',
    });
    objectVersionId = objectVersion.id;

    const textVersion = await AgencyDataSource.getRepository(
      LeadFlowBriefingSourceVersionEntity,
    ).save({
      sourceId,
      tenantId,
      workspaceId,
      versionNumber: 2,
      kind: LeadFlowBriefingSourceKind.Paste,
      rawText: 'pasted briefing text',
      mimeType: 'text/plain',
      status: LeadFlowBriefingSourceVersionStatus.Available,
      checksum: 'content-v2',
    });
    textVersionId = textVersion.id;
  });

  afterAll(async () => {
    await AgencyDataSource.getRepository(LeadFlowBriefingSourceVersionEntity).delete({
      tenantId,
    });
    await AgencyDataSource.getRepository(LeadFlowBriefingSourceEntity).delete({ tenantId });
    await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).delete({ tenantId });
  });

  function makeService() {
    return new LeadFlowBriefingContentService(
      AgencyDataSource.getRepository(LeadFlowBriefingSourceVersionEntity),
      fakeFilesService() as never,
    );
  }

  it('streams the stored object for an upload/url version', async () => {
    const service = makeService();
    const result = await service.getAuthorizedVersionContent(
      { tenantId, workspaceId, userId: randomUUID() },
      sourceId,
      objectVersionId,
    );
    expect(result.kind).toBe('object');
  });

  it('returns rawText directly for a paste version with no object storage roundtrip', async () => {
    const service = makeService();
    const result = await service.getAuthorizedVersionContent(
      { tenantId, workspaceId, userId: randomUUID() },
      sourceId,
      textVersionId,
    );
    expect(result).toEqual({
      kind: 'text',
      text: 'pasted briefing text',
      mimeType: 'text/plain',
    });
  });

  it('returns 404 (not the file) for a different tenant', async () => {
    const service = makeService();
    await expect(
      service.getAuthorizedVersionContent(
        { tenantId: randomUUID(), workspaceId, userId: randomUUID() },
        sourceId,
        objectVersionId,
      ),
    ).rejects.toThrow(/not found/);
  });

  it('returns 404 for the same tenant but a different workspace', async () => {
    const service = makeService();
    await expect(
      service.getAuthorizedVersionContent(
        { tenantId, workspaceId: randomUUID(), userId: randomUUID() },
        sourceId,
        objectVersionId,
      ),
    ).rejects.toThrow(/not found/);
  });

  it('returns 404 when the version does not belong to the given sourceId', async () => {
    const service = makeService();
    await expect(
      service.getAuthorizedVersionContent(
        { tenantId, workspaceId, userId: randomUUID() },
        randomUUID(),
        objectVersionId,
      ),
    ).rejects.toThrow(/not found/);
  });
});
