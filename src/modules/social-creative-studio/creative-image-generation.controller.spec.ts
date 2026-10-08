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
import {
  CreativeImageGenerationController,
  CreativeVersionVariationController,
} from './creative-image-generation.controller';
import {
  GenerateCreativeImageDto,
  RegenerateCreativeImageDto,
  VaryCreativeImageDto,
} from './dto/creative-image-generation.dto';

const ROUTE_PERMISSIONS = {
  generateImages: 'social.creative.content.create_draft.assigned',
  getGeneration: 'social.creative.content.view.assigned',
  outputContent: 'social.creative.content.view.assigned',
  promote: 'social.creative.content.create_draft.assigned',
  promoteAsVersion: 'social.creative.content.update.assigned',
  // CS3.6.2: a derived generation is a generation (same key as `images`).
  regenerate: 'social.creative.content.create_draft.assigned',
  varyOutput: 'social.creative.content.create_draft.assigned',
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

describe('Regeneration & variation routes (CS3.6.2)', () => {
  const scope = {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: 'client-a',
    companyContextId: 'company-a',
  };

  it('answer 202 and delegate with scope from the context and the Idempotency-Key', async () => {
    const generation = {
      regenerate: jest.fn().mockResolvedValue({}),
      varyOutput: jest.fn().mockResolvedValue({}),
      varyVersion: jest.fn().mockResolvedValue({}),
    };
    const controller = new CreativeImageGenerationController(
      generation as never,
    );
    const versions = new CreativeVersionVariationController(
      generation as never,
    );
    for (const handler of [
      CreativeImageGenerationController.prototype.regenerate,
      CreativeImageGenerationController.prototype.varyOutput,
      CreativeVersionVariationController.prototype.varyVersion,
    ])
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(202);

    await controller.regenerate(clientCtx, 'gen-1', {}, 'key-1');
    await controller.varyOutput(clientCtx, 'out-1', { prompt: 'x' }, 'key-2');
    await versions.varyVersion(
      clientCtx,
      'asset-1',
      'v-1',
      { prompt: 'y' },
      'key-3',
    );
    expect(generation.regenerate).toHaveBeenCalledWith(
      scope,
      'user-a',
      'gen-1',
      {},
      'key-1',
    );
    expect(generation.varyOutput).toHaveBeenCalledWith(
      scope,
      'user-a',
      'out-1',
      { prompt: 'x' },
      'key-2',
    );
    expect(generation.varyVersion).toHaveBeenCalledWith(
      scope,
      'user-a',
      'asset-1',
      'v-1',
      { prompt: 'y' },
      'key-3',
    );
  });

  it('the version route has the same guards, entitlement and permission', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CreativeVersionVariationController),
    ).toEqual([JwtAuthGuard, PermissionsGuard]);
    expect(
      Reflect.getMetadata(
        PRODUCT_ENTITLEMENT_METADATA,
        CreativeVersionVariationController,
      ),
    ).toBe('social');
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        CreativeVersionVariationController.prototype.varyVersion,
      ),
    ).toBe('social.creative.content.create_draft.assigned');
  });

  it('accept only legitimate overrides — never scope, Planner item, provider, model, checksum, prompt internals or storage', async () => {
    const strict = { forbidNonWhitelisted: true, whitelist: true };
    expect(
      await validate(plainToInstance(RegenerateCreativeImageDto, {}), strict),
    ).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(RegenerateCreativeImageDto, {
          prompt: 'outra luz',
          outputCount: 2,
          aspectRatio: '9:16',
          quality: 'high',
          references: [],
        }),
        strict,
      ),
    ).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(VaryCreativeImageDto, {
          prompt: 'troque o fundo',
          references: Array.from({ length: 5 }, () => ({
            source: 'brand',
            id: '70000000-0000-4000-8000-000000000001',
          })),
        }),
        strict,
      ),
    ).toHaveLength(0);

    for (const extra of [
      { contentItemId: '40000000-0000-4000-8000-000000000001' },
      { companyContextId: 'company-b' },
      { agencyClientId: '30000000-0000-4000-8000-000000000001' },
      { provider: 'openai' },
      { model: 'gpt-image-1' },
      { checksum: 'a'.repeat(64) },
      { effectivePrompt: 'x' },
      { storagePath: 'x' },
      { baseMediaAssetId: '70000000-0000-4000-8000-000000000001' },
      // The base is never a selectable reference.
      {
        references: [
          { source: 'base', id: '70000000-0000-4000-8000-000000000001' },
        ],
      },
    ]) {
      for (const Dto of [RegenerateCreativeImageDto, VaryCreativeImageDto])
        expect(
          await validate(
            plainToInstance(Dto, { prompt: 'x', ...extra }),
            strict,
          ),
        ).not.toHaveLength(0);
    }
    // A variation needs to say what changes; base + 5 is the ceiling.
    for (const bad of [
      {},
      { prompt: '' },
      {
        prompt: 'x',
        references: Array.from({ length: 6 }, () => ({
          source: 'brand',
          id: '70000000-0000-4000-8000-000000000001',
        })),
      },
    ])
      expect(
        await validate(plainToInstance(VaryCreativeImageDto, bad)),
      ).not.toHaveLength(0);
  });
});
