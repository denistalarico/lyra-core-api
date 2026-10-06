import 'reflect-metadata';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { MEDIA_ASSET_SOURCES } from '../../common/media-assets/dto/upload-media-asset.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PERMISSION_KEYS } from '../permissions/catalog/permission-keys.catalog';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../permissions/decorators/permissions.decorators';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import {
  LinkSocialContentReferenceDto,
  ReorderSocialContentReferencesDto,
  UpdateSocialContentReferenceDto,
} from './dto';
import { SocialContentReferenceController } from './social-content-reference.controller';
import type { SocialContentReferenceService } from './services/social-content-reference.service';

const ROUTE_PERMISSIONS = {
  list: 'social.planner.calendar.view.client',
  link: 'social.planner.calendar.update.manager',
  reorder: 'social.planner.calendar.update.manager',
  update: 'social.planner.calendar.update.manager',
  remove: 'social.planner.calendar.update.manager',
} as const;

const UUID = '40000000-0000-4000-8000-000000000001';
const ok = async (dto: object) =>
  validate(dto, { whitelist: true, forbidNonWhitelisted: true });

describe('Planner Visual References controller', () => {
  it('applies JWT, permission and Social entitlement guards', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SocialContentReferenceController),
    ).toEqual([JwtAuthGuard, PermissionsGuard]);
    expect(
      Reflect.getMetadata(
        PRODUCT_ENTITLEMENT_METADATA,
        SocialContentReferenceController,
      ),
    ).toBe('social');
  });

  it.each(Object.entries(ROUTE_PERMISSIONS))(
    '%s uses the content item permission key from the catalog',
    (handlerName, permission) => {
      const handler = (
        SocialContentReferenceController.prototype as unknown as Record<
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

  it('removal answers 204', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        SocialContentReferenceController.prototype.remove,
      ),
    ).toBe(204);
  });

  it('takes scope, Company Context included, from the request context only', async () => {
    const service = { link: jest.fn(async () => ({})) };
    const controller = new SocialContentReferenceController(
      service as unknown as SocialContentReferenceService,
    );
    await controller.link(
      {
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
      } as RequestContext,
      UUID,
      { mediaAssetId: UUID, kind: 'product' },
    );
    expect(service.link).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        agencyClientId: 'client-a',
        companyContextId: 'company-a',
      }),
      'user-a',
      UUID,
      { mediaAssetId: UUID, kind: 'product' },
    );
  });

  it('link accepts a media reference and a known kind only', async () => {
    expect(
      await ok(
        plainToInstance(LinkSocialContentReferenceDto, {
          mediaAssetId: UUID,
          kind: 'client_provided',
          label: 'Foto enviada pelo cliente',
        }),
      ),
    ).toHaveLength(0);
    for (const bad of [
      { mediaAssetId: 'x', kind: 'product' },
      { mediaAssetId: UUID, kind: 'logo' },
      { mediaAssetId: UUID, kind: 'product', label: 'x'.repeat(241) },
      // Scope and binaries are never accepted from the body.
      { mediaAssetId: UUID, kind: 'product', companyContextId: UUID },
      { mediaAssetId: UUID, kind: 'product', storagePath: 'k' },
      { mediaAssetId: UUID, kind: 'product', sortOrder: 3 },
    ])
      expect(
        await ok(plainToInstance(LinkSocialContentReferenceDto, bad)),
      ).not.toHaveLength(0);
  });

  it('update can clear the label with null; reorder takes 1..10 UUIDs', async () => {
    expect(
      await ok(
        plainToInstance(UpdateSocialContentReferenceDto, { label: null }),
      ),
    ).toHaveLength(0);
    expect(
      await ok(
        plainToInstance(ReorderSocialContentReferencesDto, {
          referenceIds: Array.from({ length: 11 }, () => UUID),
        }),
      ),
    ).not.toHaveLength(0);
    expect(
      await ok(
        plainToInstance(ReorderSocialContentReferencesDto, {
          referenceIds: [],
        }),
      ),
    ).not.toHaveLength(0);
  });

  it('a new reference image uploads through the media library with its own source', () => {
    expect(MEDIA_ASSET_SOURCES).toContain('planner_reference');
  });
});
