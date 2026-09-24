import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApprovalSubjectResolver } from './approval-subject-resolver';

const scope = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: 'client-a',
  companyContextId: 'company-a',
};
const input = {
  // `as const` so the literal keeps its type: without it the object widens to
  // `string` and stops satisfying the resolver's `subjectType` union, which is
  // the whole point of that union being closed.
  subjectType: 'creative_version' as const,
  subjectId: 'asset-a',
  subjectRevisionId: 'version-1',
};

describe('ApprovalSubjectResolver', () => {
  function harness() {
    const assets = { findOne: jest.fn(), findOneOrFail: jest.fn() };
    const versions = { findOne: jest.fn(), findOneOrFail: jest.fn() };
    const plans = { findOne: jest.fn() };
    const contentItems = { findOne: jest.fn() };
    const contentRevisions = { findOne: jest.fn(), findOneOrFail: jest.fn() };
    return {
      assets,
      versions,
      plans,
      contentItems,
      contentRevisions,
      resolver: new ApprovalSubjectResolver(assets as never, versions as never, plans as never, contentItems as never, contentRevisions as never),
    };
  }

  it('pins the requested version, rather than a creative asset current_version_id', async () => {
    const { assets, versions, resolver } = harness();
    assets.findOne.mockResolvedValue({
      id: 'asset-a',
      name: 'Peça',
      currentVersionId: 'version-2',
    });
    versions.findOne.mockResolvedValue({
      id: 'version-1',
      creativeAssetId: 'asset-a',
      versionNumber: 1,
    });

    await expect(resolver.resolve(scope, input)).resolves.toEqual({
      subjectType: 'creative_version',
      subjectId: 'asset-a',
      subjectRevisionId: 'version-1',
      sourceModule: 'creative_studio',
      displayType: 'creative',
      title: 'Peça',
      subjectVersionLabel: 'v1',
    });
    expect(versions.findOne).toHaveBeenCalledWith({
      where: { id: 'version-1', creativeAssetId: 'asset-a' },
    });
  });

  it.each([
    ['wrong tenant', { ...scope, tenantId: 'tenant-b' }],
    ['wrong workspace', { ...scope, workspaceId: 'workspace-b' }],
    ['wrong Agency Client', { ...scope, agencyClientId: 'client-b' }],
    ['wrong Company Context', { ...scope, companyContextId: 'company-b' }],
  ])('rejects an asset from a %s', async (_label, attemptedScope) => {
    const { assets, resolver } = harness();
    assets.findOne.mockResolvedValue(null);
    await expect(
      resolver.resolve(attemptedScope, input),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(assets.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining(attemptedScope),
    });
  });

  it('rejects unsupported, missing, and cross-asset revisions', async () => {
    const { assets, versions, resolver } = harness();
    await expect(
      resolver.resolve(scope, {
        ...input,
        subjectType: 'unsupported',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    assets.findOne.mockResolvedValue(null);
    await expect(resolver.resolve(scope, input)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    assets.findOne.mockResolvedValue({ id: 'asset-a', name: 'Peça' });
    versions.findOne.mockResolvedValue(null);
    await expect(resolver.resolve(scope, input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(versions.findOne).toHaveBeenCalledWith({
      where: { id: 'version-1', creativeAssetId: 'asset-a' },
    });
  });

  it('resolves a Planner immutable revision only through its company-owned plan', async () => {
    const { contentItems, plans, contentRevisions, resolver } = harness();
    contentItems.findOne.mockResolvedValue({ id: 'content-a', planId: 'plan-a' });
    plans.findOne.mockResolvedValue({ id: 'plan-a' });
    contentRevisions.findOne.mockResolvedValue({
      id: 'revision-a', contentItemId: 'content-a', revisionNumber: 4,
    });
    await expect(resolver.resolve(scope, {
      subjectType: 'planner_content_revision', subjectId: 'content-a', subjectRevisionId: 'revision-a',
    })).resolves.toMatchObject({
      subjectType: 'planner_content_revision', subjectId: 'content-a', subjectRevisionId: 'revision-a', subjectVersionLabel: 'r4',
    });
    expect(plans.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'plan-a', companyContextId: 'company-a' }),
    });
  });

  it('builds a Planner preview only from the persisted immutable revision fields', async () => {
    const { contentItems, plans, contentRevisions, resolver } = harness();
    contentItems.findOne.mockResolvedValue({ id: 'content-a', planId: 'plan-a', title: 'Título mutável' });
    plans.findOne.mockResolvedValue({ id: 'plan-a' });
    contentRevisions.findOne.mockResolvedValue({ id: 'revision-a', contentItemId: 'content-a', revisionNumber: 2 });
    contentRevisions.findOneOrFail.mockResolvedValue({
      id: 'revision-a', contentItemId: 'content-a', copy: 'Copy fixada', caption: 'Legenda fixada', script: 'Roteiro fixado', cta: 'Saiba mais', hashtags: ['#lyra'], firstComment: 'Primeiro comentário',
    });

    await expect(resolver.getPreview(scope, {
      subjectType: 'planner_content_revision', subjectId: 'content-a', subjectRevisionId: 'revision-a', title: 'Título do snapshot', subjectVersionLabel: 'r2',
    })).resolves.toEqual({
      subjectType: 'planner_content_revision', title: 'Título do snapshot', versionLabel: 'r2', format: 'text',
      text: { copy: 'Copy fixada', caption: 'Legenda fixada', script: 'Roteiro fixado', cta: 'Saiba mais', hashtags: ['#lyra'], firstComment: 'Primeiro comentário' },
    });
    expect(contentRevisions.findOneOrFail).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'revision-a', contentItemId: 'content-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', agencyClientId: 'client-a' }),
    });
  });

  it('returns a scoped Creative preview as authenticated API paths, never a storage URL', async () => {
    const { assets, versions, resolver } = harness();
    assets.findOne.mockResolvedValue({ id: 'asset-a', name: 'Peça', assetType: 'image' });
    versions.findOne.mockResolvedValue({ id: 'version-1', creativeAssetId: 'asset-a', versionNumber: 1 });
    assets.findOneOrFail.mockResolvedValue({ id: 'asset-a', assetType: 'image' });
    versions.findOneOrFail.mockResolvedValue({ id: 'version-1', thumbnailMediaAssetId: 'thumbnail-a' });

    const preview = await resolver.getPreview(scope, input);

    expect(preview).toMatchObject({
      format: 'media', media: {
        contentPath: '/social/creative-studio/assets/asset-a/content?versionId=version-1',
        thumbnailPath: '/social/creative-studio/assets/asset-a/thumbnail?versionId=version-1',
      },
    });
    expect(JSON.stringify(preview)).not.toMatch(/s3:|storage:|https?:\/\//i);
    expect(assets.findOneOrFail).toHaveBeenCalledWith({
      where: expect.objectContaining({ ...scope, id: 'asset-a' }),
    });
  });
});
