import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common/enums/request-method.enum';
import { Reflector } from '@nestjs/core';
import { COMPANY_CONTEXT_REQUIRED } from '../../common/context/company-aware-scope';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PERMISSION_KEYS } from '../permissions/catalog/permission-keys.catalog';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../permissions/decorators/permissions.decorators';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { SocialApprovalRequestEntity } from '../social-approvals/entities';
import { SocialApprovalsService } from '../social-approvals/social-approvals.service';
import { ApprovalSubjectResolver } from '../social-approvals/subjects/approval-subject-resolver';
import { CreativeVersionApprovalController } from './creative-version-approval.controller';
import { CreativeVersionApprovalService } from './creative-version-approval.service';

const ASSET_A = '11111111-1111-4111-8111-111111111111';
const ASSET_B = '22222222-2222-4222-8222-222222222222';
const VERSION_A1 = 'aaaaaaaa-0001-4000-8000-000000000001';
const VERSION_A2 = 'aaaaaaaa-0002-4000-8000-000000000002';
const VERSION_B1 = 'bbbbbbbb-0001-4000-8000-000000000001';

const companyA = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: 'client-a',
  companyContextId: 'company-a',
};
const companyB = { ...companyA, companyContextId: 'company-b' };
const agencyScope = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: null,
  companyContextId: null,
};

type Row = Record<string, unknown>;
const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([key, value]) => row[key] === value);

/** Exact-equality repository over an array: enough to exercise scoping. */
function memoryRepo<T extends Row>(rows: T[]) {
  return {
    rows,
    findOne: jest.fn(
      async ({ where }: { where: Row }) =>
        rows.find((row) => matches(row, where)) ?? null,
    ),
    find: jest.fn(async ({ where }: { where: Row }) =>
      rows.filter((row) => matches(row, where)),
    ),
    findOneOrFail: jest.fn(async ({ where }: { where: Row }) => {
      const found = rows.find((row) => matches(row, where));
      if (!found) throw new Error('not found');
      return found;
    }),
    create: jest.fn((value: Row) => ({ ...value })),
    save: jest.fn(async (value: T) => {
      if (!value.id) value = { ...value, id: `approval-${rows.length + 1}` };
      const index = rows.findIndex((row) => row.id === value.id);
      if (index >= 0) rows[index] = value;
      else rows.push(value);
      return value;
    }),
  };
}

function creativeStore() {
  const assets = memoryRepo([
    { id: ASSET_A, ...companyA, name: 'Post A', currentVersionId: VERSION_A1 },
    { id: ASSET_B, ...companyB, name: 'Post B', currentVersionId: VERSION_B1 },
  ]);
  const versions = memoryRepo([
    { id: VERSION_A1, creativeAssetId: ASSET_A, versionNumber: 1 },
    { id: VERSION_B1, creativeAssetId: ASSET_B, versionNumber: 1 },
  ]);
  return { assets, versions };
}

function unitHarness() {
  const store = creativeStore();
  const approvals = {
    create: jest.fn(async (_scope, _actor, input) => ({
      id: 'approval-1',
      status: 'draft',
      ...input,
    })),
  };
  const service = new CreativeVersionApprovalService(
    store.assets as never,
    store.versions as never,
    approvals as unknown as SocialApprovalsService,
  );
  return { ...store, approvals, service };
}

describe('CS2B.2 CreativeVersionApprovalService — owner-domain entry point', () => {
  it('delegates an explicit, scoped version to SocialApprovalsService.create as creative_version', async () => {
    const { service, approvals, assets } = unitHarness();

    await service.sendForApproval(companyA, 'user-a', ASSET_A, VERSION_A1);

    expect(assets.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ASSET_A, ...companyA } }),
    );
    expect(approvals.create).toHaveBeenCalledTimes(1);
    expect(approvals.create).toHaveBeenCalledWith(companyA, 'user-a', {
      subjectType: 'creative_version',
      subjectId: ASSET_A,
      subjectRevisionId: VERSION_A1,
    });
  });

  it('rejects asset A + version B: the version must belong to the scoped asset', async () => {
    const { service, approvals, versions } = unitHarness();

    await expect(
      service.sendForApproval(companyA, 'user-a', ASSET_A, VERSION_B1),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(versions.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: VERSION_B1, creativeAssetId: ASSET_A },
      }),
    );
    expect(approvals.create).not.toHaveBeenCalled();
  });

  it('does not let Company A send a version owned by Company B', async () => {
    const { service, approvals, versions } = unitHarness();

    await expect(
      service.sendForApproval(companyA, 'user-a', ASSET_B, VERSION_B1),
    ).rejects.toBeInstanceOf(NotFoundException);
    // An isolated version id is never looked up without a scoped asset first.
    expect(versions.findOne).not.toHaveBeenCalled();
    expect(approvals.create).not.toHaveBeenCalled();
  });

  it('fails closed without a Company Context (agency scope) and never reaches Approvals', async () => {
    const { service, approvals, assets } = unitHarness();

    const attempt = service.sendForApproval(
      agencyScope,
      'user-a',
      ASSET_A,
      VERSION_A1,
    );
    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toMatchObject({
      response: { code: COMPANY_CONTEXT_REQUIRED },
    });
    expect(assets.findOne).not.toHaveBeenCalled();
    expect(approvals.create).not.toHaveBeenCalled();
  });

  it('sends the selected version, not the asset current_version_id', async () => {
    const { service, approvals, assets, versions } = unitHarness();
    versions.rows.push({
      id: VERSION_A2,
      creativeAssetId: ASSET_A,
      versionNumber: 2,
    });
    assets.rows[0].currentVersionId = VERSION_A2;

    await service.sendForApproval(companyA, 'user-a', ASSET_A, VERSION_A1);

    expect(approvals.create).toHaveBeenCalledWith(
      companyA,
      'user-a',
      expect.objectContaining({ subjectRevisionId: VERSION_A1 }),
    );
  });

  it('surfaces Approvals domain errors unchanged', async () => {
    const { service, approvals } = unitHarness();
    const conflict = new ConflictException(
      'Já existe uma aprovação ativa para esta revisão neste contexto.',
    );
    approvals.create.mockRejectedValueOnce(conflict);

    await expect(
      service.sendForApproval(companyA, 'user-a', ASSET_A, VERSION_A1),
    ).rejects.toBe(conflict);
  });
});

describe('CS2B.2 CreativeVersionApprovalController — boundary', () => {
  const handler = CreativeVersionApprovalController.prototype
    .sendVersionForApproval as unknown as () => unknown;

  it('is a guarded Social route on the Studio prefix using the reserved submit_review key', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, CreativeVersionApprovalController),
    ).toBe('social/creative-studio');
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      'assets/:id/versions/:versionId/send-for-approval',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.POST,
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
    const permission = Reflect.getMetadata(PERMISSION_KEY_METADATA, handler);
    expect(permission).toBe('social.creative.content.submit_review.assigned');
    expect(PERMISSION_KEYS).toContain(permission);
  });

  it('returns the guard denial when the user lacks submit_review', async () => {
    const permissionService = {
      canAccessProduct: jest.fn().mockResolvedValue(true),
      assertCan: jest.fn().mockRejectedValue(new Error('Missing permission.')),
    };
    const guard = new PermissionsGuard(
      new Reflector(),
      permissionService as never,
      { resolve: jest.fn() } as never,
    );
    const request = {
      method: 'POST',
      route: {
        path: '/social/creative-studio/assets/:id/versions/:versionId/send-for-approval',
      },
      params: {},
      user: {
        sub: 'user-a',
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        role: 'member',
      },
      managedContext: {
        operatingMode: 'agency',
        productKey: 'social',
        clientId: null,
        managedTenantId: null,
      },
    };
    await expect(
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => handler,
        getClass: () => CreativeVersionApprovalController,
      } as unknown as ExecutionContext),
    ).rejects.toThrow('Missing permission.');
    expect(permissionService.assertCan).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a' }),
      'social.creative.content.submit_review.assigned',
      expect.anything(),
    );
  });

  const clientContext = (companyContextId: string | null): RequestContext => ({
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    userId: 'user-a',
    managedContext: {
      productKey: 'social',
      operatingMode: 'client',
      clientId: 'client-a',
      companyContextId,
      managedTenantId: null,
    },
  });

  it('derives the company scope from the validated request context only', async () => {
    const service = { sendForApproval: jest.fn() };
    const controller = new CreativeVersionApprovalController(service as never);

    await controller.sendVersionForApproval(
      clientContext('company-a'),
      ASSET_A,
      VERSION_A1,
    );

    expect(service.sendForApproval).toHaveBeenCalledWith(
      companyA,
      'user-a',
      ASSET_A,
      VERSION_A1,
    );
    // No body/query parameter exists that could carry a client or company id.
    expect(controller.sendVersionForApproval.length).toBe(3);
  });

  it('rejects client mode without a Company Context — no client-wide fallback', () => {
    const service = { sendForApproval: jest.fn() };
    const controller = new CreativeVersionApprovalController(service as never);

    expect(() =>
      controller.sendVersionForApproval(
        clientContext(null),
        ASSET_A,
        VERSION_A1,
      ),
    ).toThrow(BadRequestException);
    expect(service.sendForApproval).not.toHaveBeenCalled();
  });
});

/**
 * Contract: the Studio entry point driving the real Approvals service and the
 * real subject resolver over one in-memory store. Supersede, status and the
 * subject fields come from the Approvals domain, not from Studio code.
 */
describe('CS2B.2 contract — Studio → real SocialApprovalsService', () => {
  function contractHarness() {
    const { assets, versions } = creativeStore();
    const requests = memoryRepo<Row>([]);
    const manager = {
      query: jest.fn().mockResolvedValue(undefined),
      getRepository: (entity: unknown) => {
        if (entity !== SocialApprovalRequestEntity)
          throw new Error('unexpected repository');
        return requests;
      },
    };
    const notifications = { publish: jest.fn().mockResolvedValue(undefined) };
    const resolver = new ApprovalSubjectResolver(
      assets as never,
      versions as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const approvals = new SocialApprovalsService(
      requests as never,
      {} as never,
      {} as never,
      {
        transaction: async (fn: (m: typeof manager) => unknown) => fn(manager),
      } as never,
      resolver,
      notifications as never,
    );
    const studio = new CreativeVersionApprovalService(
      assets as never,
      versions as never,
      approvals,
    );
    return { assets, versions, requests, manager, notifications, studio };
  }

  it('creates a draft creative_version request pinned to the selected immutable version', async () => {
    const { studio, manager } = contractHarness();

    const created = await studio.sendForApproval(
      companyA,
      'user-a',
      ASSET_A,
      VERSION_A1,
    );

    expect(created).toMatchObject({
      ...companyA,
      subjectType: 'creative_version',
      subjectId: ASSET_A,
      subjectRevisionId: VERSION_A1,
      sourceModule: 'creative_studio',
      subjectVersionLabel: 'v1',
      status: 'draft',
      currentStage: 'internal',
      requestedByUserId: 'user-a',
      sentToClientAt: null,
    });
    // The domain's own advisory lock ran — the Studio did not reimplement it.
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [expect.stringContaining(`creative_version:${ASSET_A}`)],
    );
  });

  it('keeps the earlier request on its revision when a later version is created and sent', async () => {
    const { studio, versions, assets, requests, notifications } =
      contractHarness();
    const first = await studio.sendForApproval(
      companyA,
      'user-a',
      ASSET_A,
      VERSION_A1,
    );

    // A new immutable version becomes current (as CreativeAssetService.createVersion does).
    versions.rows.push({
      id: VERSION_A2,
      creativeAssetId: ASSET_A,
      versionNumber: 2,
    });
    assets.rows[0].currentVersionId = VERSION_A2;
    expect(requests.rows[0]).toMatchObject({
      subjectRevisionId: VERSION_A1,
      status: 'draft',
    });

    const second = await studio.sendForApproval(
      companyA,
      'user-a',
      ASSET_A,
      VERSION_A2,
    );

    const firstNow = requests.rows.find((row) => row.id === first.id);
    expect(firstNow).toMatchObject({
      subjectRevisionId: VERSION_A1,
      status: 'superseded',
    });
    expect(second).toMatchObject({
      subjectRevisionId: VERSION_A2,
      subjectVersionLabel: 'v2',
      status: 'draft',
    });
    expect(notifications.publish).toHaveBeenCalledWith(
      'superseded',
      expect.objectContaining({ id: first.id }),
      'user-a',
    );
  });

  it('writes nothing to Approvals for a cross-company or cross-asset attempt', async () => {
    const { studio, requests } = contractHarness();

    await expect(
      studio.sendForApproval(companyA, 'user-a', ASSET_B, VERSION_B1),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      studio.sendForApproval(companyA, 'user-a', ASSET_A, VERSION_B1),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(requests.rows).toHaveLength(0);
  });
});
