import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApprovalSubjectResolver } from './approval-subject-resolver';

const scope = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: 'client-a',
  companyContextId: 'company-a',
};
const input = {
  subjectType: 'creative_version',
  subjectId: 'asset-a',
  subjectRevisionId: 'version-1',
};

describe('ApprovalSubjectResolver', () => {
  function harness() {
    const assets = { findOne: jest.fn() };
    const versions = { findOne: jest.fn() };
    return {
      assets,
      versions,
      resolver: new ApprovalSubjectResolver(assets as never, versions as never),
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
        subjectType: 'planner_content_revision',
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
});
