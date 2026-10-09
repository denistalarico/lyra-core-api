import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common/enums/request-method.enum';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../permissions';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../permissions/decorators/permissions.decorators';
import { SOCIAL_APPROVAL_STATUSES } from '../social-approvals/entities/social-approval-request.entity';
import { CreativeVersionApprovalController } from './creative-version-approval.controller';
import { CreativeVersionApprovalService } from './creative-version-approval.service';

const scope = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: 'client-a',
  companyContextId: 'company-a',
};
const context: RequestContext = {
  tenantId: scope.tenantId,
  workspaceId: scope.workspaceId,
  userId: 'user-a',
  managedContext: {
    productKey: 'social',
    operatingMode: 'client',
    clientId: scope.agencyClientId,
    companyContextId: scope.companyContextId,
    managedTenantId: null,
  },
};

function harness() {
  const asset = {
    id: 'asset-a',
    ...scope,
    currentVersionId: 'version-a2',
    contentItemId: 'content-a',
  };
  const assets = {
    findOne: jest.fn(async ({ where }) =>
      Object.entries(where).every(([key, value]) => asset[key] === value)
        ? asset
        : null,
    ),
  };
  const versions = {
    findOne: jest.fn(async ({ where }) =>
      where.creativeAssetId === asset.id &&
      ['version-a1', 'version-a2'].includes(where.id)
        ? { id: where.id }
        : null,
    ),
  };
  const approvals = {
    findStateForSubjectRevision: jest.fn().mockResolvedValue(null),
  };
  const plannerStatus = { reflectCreativeStatus: jest.fn() };
  const service = new CreativeVersionApprovalService(
    assets as never,
    versions as never,
    approvals as never,
    plannerStatus as never,
    {} as never,
  );
  return { service, assets, versions, approvals, plannerStatus };
}

describe('CS2B.3 Studio approval projection', () => {
  it('returns approval: null for an authorized version without a request', async () => {
    const { service } = harness();
    await expect(
      service.approvalForVersion(scope, 'asset-a', 'version-a1'),
    ).resolves.toEqual({ approval: null });
  });

  it.each(SOCIAL_APPROVAL_STATUSES)(
    'preserves the official %s state and real metadata without touching the Planner',
    async (status) => {
      const { service, approvals, plannerStatus } = harness();
      const approval = {
        approvalId: 'approval-a',
        status,
        currentStage: 'client',
        createdAt: new Date('2026-10-01T12:00:00Z'),
        sentToClientAt: new Date('2026-10-02T12:00:00Z'),
        approvedAt: null,
        cancelledAt: null,
        supersededAt: null,
      };
      approvals.findStateForSubjectRevision.mockResolvedValue(approval);
      await expect(
        service.approvalForVersion(scope, 'asset-a', 'version-a1'),
      ).resolves.toEqual({ approval });
      // CS2B.4: Approval statuses are read, never mirrored into planningStatus.
      expect(plannerStatus.reflectCreativeStatus).not.toHaveBeenCalled();
    },
  );

  it('reads each explicit revision even when another version is current', async () => {
    const { service, approvals } = harness();
    await service.approvalForVersion(scope, 'asset-a', 'version-a1');
    await service.approvalForVersion(scope, 'asset-a', 'version-a2');
    expect(approvals.findStateForSubjectRevision.mock.calls).toEqual([
      [
        scope,
        {
          subjectType: 'creative_version',
          subjectId: 'asset-a',
          subjectRevisionId: 'version-a1',
        },
      ],
      [
        scope,
        {
          subjectType: 'creative_version',
          subjectId: 'asset-a',
          subjectRevisionId: 'version-a2',
        },
      ],
    ]);
  });

  it('rejects an asset/version mismatch before reading Approvals', async () => {
    const { service, approvals } = harness();
    await expect(
      service.approvalForVersion(scope, 'asset-a', 'version-b1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(approvals.findStateForSubjectRevision).not.toHaveBeenCalled();
  });

  it.each(['tenantId', 'workspaceId', 'agencyClientId', 'companyContextId'])(
    'a known version cannot bypass asset authorization for %s',
    async (key) => {
      const { service, versions, approvals } = harness();
      await expect(
        service.approvalForVersion(
          { ...scope, [key]: 'other' },
          'asset-a',
          'version-a1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(versions.findOne).not.toHaveBeenCalled();
      expect(approvals.findStateForSubjectRevision).not.toHaveBeenCalled();
    },
  );

  it('refuses legacy (client, null) scope before any repository read', async () => {
    const { service, assets, approvals } = harness();
    await expect(
      service.approvalForVersion(
        { ...scope, companyContextId: null },
        'asset-a',
        'version-a1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(assets.findOne).not.toHaveBeenCalled();
    expect(approvals.findStateForSubjectRevision).not.toHaveBeenCalled();
  });

  it('CS5 Closeout: the own scope (null, null) reads only its own assets — a client asset is not found', async () => {
    const { service, approvals } = harness();
    await expect(
      service.approvalForVersion(
        { ...scope, agencyClientId: null, companyContextId: null },
        'asset-a',
        'version-a1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(approvals.findStateForSubjectRevision).not.toHaveBeenCalled();
  });
});

describe('CS2B.3 read endpoint contract', () => {
  it('denies the request through PermissionsGuard when Approvals read permission is missing', async () => {
    const permissionService = {
      canAccessProduct: jest.fn().mockResolvedValue(true),
      canAccessClientProduct: jest.fn().mockResolvedValue(true),
      assertCan: jest
        .fn()
        .mockRejectedValue(new Error('Missing approval read permission.')),
    };
    const guard = new PermissionsGuard(
      new Reflector(),
      permissionService as never,
      {} as never,
    );
    const request = {
      method: 'GET',
      params: {},
      route: {
        path: '/social/creative-studio/assets/:id/versions/:versionId/approval',
      },
      user: {
        sub: 'user-a',
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        role: 'member',
      },
      managedContext: context.managedContext,
    };
    await expect(
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () =>
          CreativeVersionApprovalController.prototype.versionApproval,
        getClass: () => CreativeVersionApprovalController,
      } as unknown as ExecutionContext),
    ).rejects.toThrow('Missing approval read permission.');
    expect(permissionService.assertCan).toHaveBeenCalledWith(
      expect.anything(),
      'social.approvals.review.view.assigned',
      expect.anything(),
    );
  });

  it('uses the Social guards, entitlement, and official Approvals read permission', () => {
    const handler = CreativeVersionApprovalController.prototype.versionApproval;
    expect(
      Reflect.getMetadata(PATH_METADATA, CreativeVersionApprovalController),
    ).toBe('social/creative-studio');
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      'assets/:id/versions/:versionId/approval',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CreativeVersionApprovalController),
    ).toEqual([JwtAuthGuard, PermissionsGuard]);
    expect(
      Reflect.getMetadata(
        PRODUCT_ENTITLEMENT_METADATA,
        CreativeVersionApprovalController,
      ),
    ).toBe('social');
    expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, handler)).toBe(
      'social.approvals.review.view.assigned',
    );
  });

  it('derives ownership only from validated RequestContext and returns the read response', async () => {
    const service = {
      approvalForVersion: jest.fn().mockResolvedValue({ approval: null }),
    };
    const controller = new CreativeVersionApprovalController(service as never);
    await expect(
      controller.versionApproval(context, 'asset-a', 'version-a1'),
    ).resolves.toEqual({ approval: null });
    expect(service.approvalForVersion).toHaveBeenCalledWith(
      scope,
      'asset-a',
      'version-a1',
    );
  });

  it('rejects client mode without company rather than falling back to client-wide scope', () => {
    const service = { approvalForVersion: jest.fn() };
    const controller = new CreativeVersionApprovalController(service as never);
    expect(() =>
      controller.versionApproval(
        {
          ...context,
          managedContext: {
            ...context.managedContext!,
            companyContextId: null,
          },
        },
        'asset-a',
        'version-a1',
      ),
    ).toThrow(BadRequestException);
    expect(service.approvalForVersion).not.toHaveBeenCalled();
  });
});
