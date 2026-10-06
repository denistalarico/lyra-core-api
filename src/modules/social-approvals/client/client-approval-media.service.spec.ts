import { NotFoundException } from '@nestjs/common';
import { ClientApprovalMediaService } from './client-approval-media.service';

/**
 * AP3 §62 — the media security matrix.
 *
 * Every rejection is the same `NotFoundException`: whether the approval is
 * from another company, the asset belongs to a different approval, or the ref
 * is forged, the answer is identical, so nothing about the other side is
 * discoverable.
 */

const scope = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: 'client-a',
  companyContextId: 'company-a',
};

const approvalA = {
  id: 'approval-a',
  subjectType: 'creative_version',
  subjectId: 'asset-a',
  subjectRevisionId: 'version-a',
};

function build({
  approval = approvalA,
  asset = { id: 'asset-a' },
  version = {
    id: 'version-a',
    creativeAssetId: 'asset-a',
    mediaAssetId: 'media-a',
    thumbnailMediaAssetId: 'thumb-a',
  },
  resolved = {
    id: 'media-a',
    storagePath: 'private/a.png',
    mimeType: 'image/png',
  },
}: {
  approval?: unknown;
  asset?: unknown;
  version?: unknown;
  resolved?: unknown;
} = {}) {
  const approvals = {
    findVisible: jest.fn().mockImplementation(() => {
      if (!approval) throw new NotFoundException('Aprovação não encontrada.');
      return Promise.resolve(approval);
    }),
  };
  const assets = { findOne: jest.fn().mockResolvedValue(asset) };
  const versions = { findOne: jest.fn().mockResolvedValue(version) };
  const media = {
    resolve: jest.fn().mockImplementation(() => {
      if (!resolved) throw new NotFoundException('Media asset not found.');
      return Promise.resolve(resolved);
    }),
  };

  const service = new ClientApprovalMediaService(
    assets as never,
    versions as never,
    approvals as never,
    media as never,
  );

  return { service, approvals, assets, versions, media };
}

describe('AP3 client media boundary', () => {
  it('serves the media of the approval it was requested through', async () => {
    const { service, media } = build();

    const result = await service.resolve(scope, 'approval-a', 'content');

    expect(result.storagePath).toBe('private/a.png');
    expect(media.resolve).toHaveBeenCalledWith({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
      mediaAssetId: 'media-a',
    });
  });

  it('serves the thumbnail slot from the same revision', async () => {
    const { service, media } = build();

    await service.resolve(scope, 'approval-a', 'thumbnail');

    expect(media.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ mediaAssetId: 'thumb-a' }),
    );
  });

  it('derives the revision from the approval, so media of B cannot be fetched through A', async () => {
    // The approval row is the only source of the revision id, so a caller
    // naming approval A can only ever reach A's own revision.
    const { service, versions } = build();

    await service.resolve(scope, 'approval-a', 'content');

    expect(versions.findOne).toHaveBeenCalledWith({
      where: { id: 'version-a', creativeAssetId: 'asset-a' },
    });
  });

  it('rejects an approval that is not visible to this company', async () => {
    const { service, media } = build({ approval: null });

    await expect(
      service.resolve(scope, 'approval-b', 'content'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(media.resolve).not.toHaveBeenCalled();
  });

  it('rejects an unrelated asset in the same company', async () => {
    // The approval is visible, but its subject asset does not resolve inside
    // the scope: a same-company asset that is not this approval's subject.
    const { service, media } = build({ asset: null });

    await expect(
      service.resolve(scope, 'approval-a', 'content'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(media.resolve).not.toHaveBeenCalled();
  });

  it('rejects when the revision does not belong to the approval subject', async () => {
    const { service, media } = build({ version: null });

    await expect(
      service.resolve(scope, 'approval-a', 'content'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(media.resolve).not.toHaveBeenCalled();
  });

  it('rejects a tampered storage key or any ref outside the enumeration', async () => {
    const { service, approvals, media } = build();

    for (const forged of [
      'private/tenant-b/asset.png',
      '../../../etc/passwd',
      's3://bucket/object',
      'content?versionId=other',
      'CONTENT',
    ]) {
      await expect(
        service.resolve(scope, 'approval-a', forged),
      ).rejects.toBeInstanceOf(NotFoundException);
    }

    // A forged ref never even reaches the approval lookup.
    expect(approvals.findVisible).not.toHaveBeenCalled();
    expect(media.resolve).not.toHaveBeenCalled();
  });

  it('has no media slot for a text revision', async () => {
    const { service, media } = build({
      approval: {
        id: 'approval-text',
        subjectType: 'planner_content_revision',
        subjectId: 'item-1',
        subjectRevisionId: 'revision-1',
      },
    });

    await expect(
      service.resolve(scope, 'approval-text', 'content'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(media.resolve).not.toHaveBeenCalled();
  });

  it('rejects when the requested slot is empty on the revision', async () => {
    const { service } = build({
      version: {
        id: 'version-a',
        creativeAssetId: 'asset-a',
        mediaAssetId: 'media-a',
        thumbnailMediaAssetId: null,
      },
    });

    await expect(
      service.resolve(scope, 'approval-a', 'thumbnail'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('re-checks scope at the resolver, so a cross-tenant asset still fails', async () => {
    const { service } = build({ resolved: null });

    await expect(
      service.resolve(scope, 'approval-a', 'content'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
