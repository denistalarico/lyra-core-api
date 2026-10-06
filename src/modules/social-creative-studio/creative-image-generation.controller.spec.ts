import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
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
import { CreativeImageGenerationController } from './creative-image-generation.controller';
import { GenerateCreativeImageDto } from './dto/creative-image-generation.dto';

const ROUTE_PERMISSIONS = {
  generateImages: 'social.creative.content.create_draft.assigned',
  getGeneration: 'social.creative.content.view.assigned',
  outputContent: 'social.creative.content.view.assigned',
  promote: 'social.creative.content.create_draft.assigned',
  promoteAsVersion: 'social.creative.content.update.assigned',
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

describe('Creative image generation controller (CS3.1/CS3.2)', () => {
  it('applies JWT, permission and Social entitlement guards', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CreativeImageGenerationController),
    ).toEqual([JwtAuthGuard, PermissionsGuard]);
    expect(
      Reflect.getMetadata(
        PRODUCT_ENTITLEMENT_METADATA,
        CreativeImageGenerationController,
      ),
    ).toBe('social');
  });

  it.each(Object.entries(ROUTE_PERMISSIONS))(
    '%s uses the existing permission catalog key',
    (handlerName, permission) => {
      const handler = (
        CreativeImageGenerationController.prototype as unknown as Record<
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

  it('answers 202 Accepted to a generation request', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        CreativeImageGenerationController.prototype.generateImages,
      ),
    ).toBe(202);
  });

  it('reads a generation in the context scope only', async () => {
    const generation = { get: jest.fn().mockResolvedValue({}) };
    const controller = new CreativeImageGenerationController(
      generation as never,
    );

    await controller.getGeneration(clientCtx, 'gen-1');

    expect(generation.get).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: 'client-a',
        companyContextId: 'company-a',
      },
      'gen-1',
    );
  });

  it('takes scope, including Company Context, from the request context only', async () => {
    const generation = { enqueue: jest.fn().mockResolvedValue({}) };
    const controller = new CreativeImageGenerationController(
      generation as never,
    );

    await controller.generateImages(clientCtx, { prompt: 'x' }, 'key-1');

    expect(generation.enqueue).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: 'client-a',
        companyContextId: 'company-a',
      },
      'user-a',
      { prompt: 'x' },
      'key-1',
    );
    expect(() =>
      controller.generateImages(
        {
          ...clientCtx,
          managedContext: {
            ...clientCtx.managedContext!,
            companyContextId: null,
          },
        },
        { prompt: 'x' },
        'key-1',
      ),
    ).toThrow(BadRequestException);
  });

  it('accepts Lyra vocabulary only', async () => {
    const ok = plainToInstance(GenerateCreativeImageDto, {
      prompt: 'café',
      outputCount: '2',
      aspectRatio: '4:5',
      quality: 'high',
      contentItemId: '40000000-0000-4000-8000-000000000001',
      references: [
        { source: 'brand', id: '70000000-0000-4000-8000-000000000001' },
        { source: 'planner', id: '71000000-0000-4000-8000-000000000001' },
        {
          source: 'operator',
          id: '72000000-0000-4000-8000-000000000001',
          kind: 'product',
        },
      ],
    });
    expect(
      await validate(ok, { forbidNonWhitelisted: true, whitelist: true }),
    ).toHaveLength(0);
    expect(ok.outputCount).toBe(2);

    for (const extra of [
      { model: 'gpt-image-1' },
      { provider: 'openai' },
      { size: '1024x1024' },
      { companyContextId: 'company-b' },
      // CS3.4.1: context is resolved server-side, never accepted as data.
      { agencyClientId: '30000000-0000-4000-8000-000000000001' },
      { palette: [{ role: 'primary', hex: '#000000' }] },
      { guidelines: 'x' },
      { caption: 'x' },
      { effectivePrompt: 'x' },
      // CS3.4.2: never bytes, storage keys or URLs for a reference.
      {
        references: [
          {
            source: 'operator',
            id: '70000000-0000-4000-8000-000000000001',
            kind: 'product',
            storagePath: 'x',
          },
        ],
      },
      {
        references: [
          {
            source: 'operator',
            id: '70000000-0000-4000-8000-000000000001',
            kind: 'product',
            url: 'https://x',
          },
        ],
      },
      {
        references: [
          {
            source: 'brand',
            id: '70000000-0000-4000-8000-000000000001',
            body: 'iVBOR',
          },
        ],
      },
    ]) {
      const dto = plainToInstance(GenerateCreativeImageDto, {
        prompt: 'x',
        ...extra,
      });
      expect(
        await validate(dto, { forbidNonWhitelisted: true, whitelist: true }),
      ).not.toHaveLength(0);
    }

    for (const bad of [
      { prompt: '' },
      { prompt: 'x', outputCount: 5 },
      { prompt: 'x', aspectRatio: '3:2' },
      { prompt: 'x', quality: 'ultra' },
      { prompt: 'x', contentItemId: 'not-a-uuid' },
      // CS3.4.2: references are owner ids of a closed source vocabulary.
      {
        prompt: 'x',
        references: [
          { source: 'upload', id: '70000000-0000-4000-8000-000000000001' },
        ],
      },
      { prompt: 'x', references: [{ source: 'brand', id: 'not-a-uuid' }] },
      {
        prompt: 'x',
        references: [
          {
            source: 'operator',
            id: '70000000-0000-4000-8000-000000000001',
            kind: 'logo',
          },
        ],
      },
      { prompt: 'x', references: 'all' },
      {
        prompt: 'x',
        references: Array.from({ length: 7 }, () => ({
          source: 'brand',
          id: '70000000-0000-4000-8000-000000000001',
        })),
      },
    ])
      expect(
        await validate(plainToInstance(GenerateCreativeImageDto, bad)),
      ).not.toHaveLength(0);
  });
});
