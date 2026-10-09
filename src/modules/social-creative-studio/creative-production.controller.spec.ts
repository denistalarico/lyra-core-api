import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PERMISSION_KEYS } from '../permissions/catalog/permission-keys.catalog';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../permissions/decorators/permissions.decorators';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { CreativeProductionController } from './creative-production.controller';
import { CREATIVE_PRODUCTION_PERMISSIONS } from './creative-production.permissions';
import {
  CreateProductionTaskDto,
  HandoffProductionDestinationDto,
  ProductionWorkCandidatesQueryDto,
  SelectCreativeVersionDto,
  UploadProductionCreativeDto,
} from './dto/creative-production.dto';

const ROUTE_PERMISSIONS = {
  view: 'social.creative.content.view.assigned',
  select: 'social.creative.content.update.assigned',
  clearSelection: 'social.creative.content.update.assigned',
  sendForApproval: 'social.creative.content.submit_review.assigned',
  linkTask: 'social.creative.content.update.assigned',
  unlinkTask: 'social.creative.content.update.assigned',
  createTask: 'social.creative.content.update.assigned',
  handoff: 'social.planner.calendar.update.manager',
  reconcile: 'social.creative.content.update.assigned',
  // CS5 Closeout.
  uploadCreative: 'social.creative.content.update.assigned',
  taskCandidates: 'social.creative.content.update.assigned',
  projectCandidates: 'social.creative.content.update.assigned',
} as const;

const clientCtx = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  userId: 'user-a',
  managedContext: {
    productKey: 'social',
    operatingMode: 'client',
    clientId: 'client-a',
    companyContextId: 'company-a',
    managedTenantId: 'managed-tenant-a',
  },
} as RequestContext;

describe('Creative production controller (CS5-B)', () => {
  it('applies JWT, permission and Social entitlement guards', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CreativeProductionController),
    ).toEqual([JwtAuthGuard, PermissionsGuard]);
    expect(
      Reflect.getMetadata(
        PRODUCT_ENTITLEMENT_METADATA,
        CreativeProductionController,
      ),
    ).toBe('social');
  });

  it.each(Object.entries(ROUTE_PERMISSIONS))(
    '%s uses the existing permission catalog key',
    (handlerName, permission) => {
      const handler = (
        CreativeProductionController.prototype as unknown as Record<
          string,
          () => unknown
        >
      )[handlerName];
      expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, handler)).toBe(
        permission,
      );
      expect(PERMISSION_KEYS).toContain(permission);
    },
  );

  it('every key the service checks (including the Agency ones) is in the catalog', () => {
    for (const key of Object.values(CREATIVE_PRODUCTION_PERMISSIONS))
      expect(PERMISSION_KEYS).toContain(key);
  });

  it('takes scope only from the request context, never from the body', async () => {
    const production = {
      selectVersion: jest.fn(async () => ({})),
    };
    const controller = new CreativeProductionController(production as never);
    await controller.select(clientCtx, 'content-a', {
      versionId: 'version-a',
      // A forged scope is simply not part of the contract.
      companyContextId: 'company-b',
    } as SelectCreativeVersionDto);
    expect(production.selectVersion).toHaveBeenCalledWith(
      clientCtx,
      {
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: 'client-a',
        companyContextId: 'company-a',
      },
      'content-a',
      'version-a',
    );
  });

  it('validates the command bodies', async () => {
    const errors = async (cls: new () => object, body: object) =>
      (await validate(plainToInstance(cls, body))).map((e) => e.property);
    expect(await errors(SelectCreativeVersionDto, {})).toEqual(['versionId']);
    expect(
      await errors(HandoffProductionDestinationDto, {
        organicAssetId: 'nope',
        replaceExisting: 'yes',
      }),
    ).toEqual(['organicAssetId', 'replaceExisting']);
    expect(
      await errors(CreateProductionTaskDto, {
        title: 'x'.repeat(181),
        dueDate: 'tomorrow',
      }),
    ).toEqual(['title', 'dueDate']);
    expect(await errors(CreateProductionTaskDto, {})).toEqual([]);
    expect(
      await errors(UploadProductionCreativeDto, { origin: 'campaigns' }),
    ).toEqual(['origin']);
    expect(
      await errors(UploadProductionCreativeDto, { origin: 'planner' }),
    ).toEqual([]);
    expect(
      await errors(ProductionWorkCandidatesQueryDto, { limit: '500' }),
    ).toEqual(['limit']);
    expect(
      await errors(ProductionWorkCandidatesQueryDto, { limit: '10' }),
    ).toEqual([]);
  });

  it('CS5 Closeout: upload and candidates take scope only from the request context', async () => {
    const production = {
      uploadAndSelect: jest.fn(async () => ({})),
      taskCandidates: jest.fn(async () => ({ items: [] })),
      projectCandidates: jest.fn(async () => ({ items: [] })),
    };
    const controller = new CreativeProductionController(production as never);
    const scope = {
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-a',
      companyContextId: 'company-a',
    };
    const file = { buffer: Buffer.from('x') } as Express.Multer.File;
    await controller.uploadCreative(clientCtx, 'content-a', file, {
      origin: 'planner',
    });
    expect(production.uploadAndSelect).toHaveBeenCalledWith(
      clientCtx,
      scope,
      'content-a',
      file,
      { origin: 'planner' },
    );
    await controller.taskCandidates(clientCtx, 'content-a', { search: 'arte' });
    expect(production.taskCandidates).toHaveBeenCalledWith(
      clientCtx,
      scope,
      'content-a',
      { search: 'arte' },
    );
    await controller.projectCandidates(clientCtx, 'content-a', {});
    expect(production.projectCandidates).toHaveBeenCalledWith(
      scope,
      'content-a',
      {},
    );
  });
});
