// src/modules/brand-kit/services/brand-kit.service.ts
//
// Brand Kit domain service (Lyra Social S1.4.9).
//
// Every method takes the ALREADY-AUTHORIZED `agencyClientId` from the
// controller — the value `PermissionsGuard`/`OperationalContextResolver`
// resolved from the caller's own product headers, never a client id from a
// body or a query string. `tenantId`/`workspaceId` come from the
// authenticated context. That is what makes the scope columns trustworthy.

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { FilesService } from '../../../common/files/files.service';
import { BrandKitAssetEntity, BrandKitEntity } from '../entities';
import type {
  BrandKitAssetKind,
  BrandKitAssetTheme,
  BrandKitAssetVariant,
} from '../entities';
import {
  BrandKitResponse,
  mapBrandKitAssetResponse,
  mapBrandKitResponse,
  type BrandKitAssetResponse,
} from '../dto/brand-kit.view';
import { UpdateBrandKitDto } from '../dto/update-brand-kit.dto';
import {
  assertBrandKitSize,
  buildBrandKitObjectKey,
  resolveBrandKitContentType,
  sanitizeBrandKitFilename,
} from '../brand-kit-upload.rules';

const AGENCY_CONNECTION = 'agency';

type BrandKitScope = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
};

export type BrandKitAssetUpload = {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
  size?: number;
};

@Injectable()
export class BrandKitService {
  private readonly logger = new Logger(BrandKitService.name);

  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    @InjectRepository(BrandKitEntity, AGENCY_CONNECTION)
    private readonly kits: Repository<BrandKitEntity>,
    @InjectRepository(BrandKitAssetEntity, AGENCY_CONNECTION)
    private readonly assets: Repository<BrandKitAssetEntity>,
    private readonly filesService: FilesService,
  ) {}

  /**
   * Reads the Brand Kit for the active scope.
   *
   * Deliberately does NOT create a row (§14): a GET that writes turns every
   * page view — including one from a read-only viewer — into a mutation, and
   * would litter the table with empty kits for scopes nobody ever configured.
   * A missing kit is reported as empty defaults with `id: null`, which the
   * editor renders as a blank state.
   */
  async getBrandKit(
    ctx: RequestContext,
    agencyClientId: string | null,
  ): Promise<BrandKitResponse> {
    const scope = this.resolveScope(ctx, agencyClientId);
    const kit = await this.findKit(scope);
    const assets = kit ? await this.listKitAssets(kit.id, scope) : [];

    return mapBrandKitResponse(kit, assets, agencyClientId);
  }

  async updateBrandKit(
    ctx: RequestContext,
    agencyClientId: string | null,
    dto: UpdateBrandKitDto,
  ): Promise<BrandKitResponse> {
    const scope = this.resolveScope(ctx, agencyClientId);
    const kit = await this.ensureKit(scope, ctx.userId ?? null);

    // Only keys actually present are written. Assigning the whole DTO would
    // blank `guidelines` on a palette-only PATCH — the undefined-overwrite
    // bug this codebase has hit before.
    if (dto.palette !== undefined) {
      kit.palette = dto.palette.map((entry) => ({
        role: entry.role,
        hex: entry.hex,
        label: entry.label ?? null,
      }));
    }
    if (dto.typography !== undefined) {
      kit.typography = dto.typography.map((entry) => ({
        role: entry.role,
        family: entry.family,
        source: entry.source ?? null,
        weights: entry.weights ?? [],
      }));
    }
    if (dto.guidelines !== undefined) {
      kit.guidelines = dto.guidelines;
    }
    kit.updatedById = ctx.userId ?? null;

    const saved = await this.kits.save(kit);
    const assets = await this.listKitAssets(saved.id, scope);

    return mapBrandKitResponse(saved, assets, agencyClientId);
  }

  async listAssets(
    ctx: RequestContext,
    agencyClientId: string | null,
  ): Promise<BrandKitAssetResponse[]> {
    const scope = this.resolveScope(ctx, agencyClientId);
    const kit = await this.findKit(scope);
    if (!kit) return [];

    const assets = await this.listKitAssets(kit.id, scope);
    return assets.map(mapBrandKitAssetResponse);
  }

  /**
   * Uploads a binary to the PRIVATE bucket and records its metadata.
   *
   * Order is deliberate (§17): validate everything → ensure the kit → mint
   * the asset id and key → put the object → insert the row. If the insert
   * fails, the object just written is best-effort removed, because the
   * alternative is a binary in the bucket that no row references and nothing
   * will ever clean up. The reverse order (row first) would be worse: a row
   * pointing at a key that does not exist renders as a permanently broken
   * image with no way to tell it apart from a real asset.
   */
  async uploadAsset(
    ctx: RequestContext,
    agencyClientId: string | null,
    input: {
      file: BrandKitAssetUpload;
      kind: BrandKitAssetKind;
      variant?: BrandKitAssetVariant | null;
      theme?: BrandKitAssetTheme | null;
    },
  ): Promise<BrandKitAssetResponse> {
    const scope = this.resolveScope(ctx, agencyClientId);
    const file = input.file;

    if (!file?.buffer?.length) {
      throw new BadRequestException('Nenhum arquivo foi enviado.');
    }

    // 1. Validate before anything is created or written anywhere.
    assertBrandKitSize(file.size ?? file.buffer.length);
    assertBrandKitSize(file.buffer.length);
    const contentType = resolveBrandKitContentType(file.buffer, file.mimetype);

    // A reference has no shape axis; the DB CHECK agrees, and rejecting here
    // gives a 400 instead of a driver error.
    const variant = input.kind === 'logo' ? (input.variant ?? null) : null;
    const theme = input.kind === 'logo' ? (input.theme ?? null) : null;

    // 2. Ensure the kit exists (race-safe — see `ensureKit`).
    const kit = await this.ensureKit(scope, ctx.userId ?? null);

    // 3. Server-controlled id and key. No part of the user's filename.
    const { assetId, objectKey } = buildBrandKitObjectKey({
      tenantId: scope.tenantId,
      agencyClientId: scope.agencyClientId,
      assetId: randomUUID(),
      contentType,
    });

    // 4. Object first.
    await this.filesService.uploadPrivateBuffer({
      body: file.buffer,
      path: objectKey,
      contentType,
    });

    // 5. Metadata second, with cleanup if it fails.
    try {
      const saved = await this.assets.save(
        this.assets.create({
          id: assetId,
          brandKitId: kit.id,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          kind: input.kind,
          variant,
          theme,
          storagePath: objectKey,
          mimeType: contentType,
          byteSize: String(file.buffer.length),
          width: null,
          height: null,
          originalFilename: sanitizeBrandKitFilename(file.originalname),
          checksum: createHash('sha256').update(file.buffer).digest('hex'),
          metadata: {},
          createdById: ctx.userId ?? null,
        }),
      );

      return mapBrandKitAssetResponse(saved);
    } catch (error) {
      await this.bestEffortRemoveObject(objectKey, 'upload rollback');
      throw error;
    }
  }

  /**
   * Resolves an asset for reading its bytes.
   *
   * The scope filter is the authorization: an asset belonging to another
   * tenant, to the agency when a client context is active, or to a different
   * client, simply does not match and surfaces as 404 — the same answer as an
   * id that never existed, so the endpoint never confirms that someone
   * else's asset is real (§13/§26).
   */
  async getAssetContent(
    ctx: RequestContext,
    agencyClientId: string | null,
    assetId: string,
  ) {
    const asset = await this.findScopedAsset(ctx, agencyClientId, assetId);
    const file = await this.filesService.getPrivateAsset(asset.storagePath);

    return { asset, file };
  }

  /**
   * Deletes an asset: tombstone → storage → finalization.
   *
   * The order matters, and the earlier "row first, then best-effort object"
   * shape was wrong in a specific way: when the storage call failed it had
   * already destroyed `storage_path`, the asset id and the scope — the exact
   * metadata a human or a future reconciler needs to find the orphaned
   * binary. The failure was reported as success, so nothing would ever look
   * again.
   *
   * Now:
   *  1. resolve the asset under the caller's own scope (ownership);
   *  2. mark `deleted_at` — from this instant the asset is invisible to
   *     listing and to the content endpoint, so the customer's intent takes
   *     effect immediately even though the bytes may still exist;
   *  3. remove the object from the private bucket;
   *  4. only once the bytes are provably gone, drop the row.
   *
   * If step 3 fails the row SURVIVES, tombstoned, with `storage_path` intact,
   * and the request fails with 5xx — the physical operation did not finish,
   * and saying otherwise is what created the untraceable orphan. Retrying the
   * same DELETE resumes from the tombstone (see `findScopedAsset`'s
   * `includeDeleted`).
   */
  async deleteAsset(
    ctx: RequestContext,
    agencyClientId: string | null,
    assetId: string,
  ): Promise<void> {
    // A retry must find the asset it already tombstoned, so deleted rows are
    // in scope *here only* — every other read path excludes them.
    const asset = await this.findScopedAsset(ctx, agencyClientId, assetId, {
      includeDeleted: true,
    });

    // (A) Tombstone first. If this throws, storage is never touched and the
    // asset stays fully intact — a failed delete must not remove bytes.
    if (!asset.deletedAt) {
      await this.assets.softDelete({
        id: asset.id,
        tenantId: asset.tenantId,
      });
    }

    // (B) Remove the binary. A key that is already gone counts as done, which
    // is what makes the retry converge instead of blocking forever.
    await this.removePrivateObject(asset.storagePath);

    // (C) The bytes are gone; the tombstone has nothing left to protect.
    // If this fails, the asset stays tombstoned — invisible and unreadable —
    // and a retry finalizes it without needing the object to exist again.
    await this.assets.delete({ id: asset.id, tenantId: asset.tenantId });
  }

  /**
   * `includeDeleted` is opt-in and used by exactly one caller: `deleteAsset`,
   * so a retry can resume the cleanup it already started. Every other path —
   * listing, content — leaves it off, so a tombstoned asset is as absent as
   * one that never existed. TypeORM excludes soft-deleted rows by default,
   * which is what makes "off" the safe default rather than something each
   * query has to remember.
   */
  private async findScopedAsset(
    ctx: RequestContext,
    agencyClientId: string | null,
    assetId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<BrandKitAssetEntity> {
    const scope = this.resolveScope(ctx, agencyClientId);

    // Guards against a malformed id reaching the driver as a cast error.
    if (!UUID_PATTERN.test(assetId)) {
      throw new NotFoundException('Asset not found.');
    }

    const asset = await this.assets.findOne({
      where: {
        id: assetId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId ?? IsNull(),
      },
      withDeleted: options.includeDeleted ?? false,
    });

    if (!asset) {
      throw new NotFoundException('Asset not found.');
    }

    return asset;
  }

  /**
   * Returns the scope's kit, creating it if absent — safely under
   * concurrency.
   *
   * A plain `SELECT` → `if missing` → `INSERT` loses a race: two parallel
   * uploads both see nothing and both insert. Here the insert is issued with
   * `ON CONFLICT DO NOTHING` against the partial unique indexes, then the row
   * is read back. The loser of the race conflicts silently and reads the
   * winner's row, so both callers end up with the same kit and no duplicate
   * can exist — which is exactly what the two partial indexes are for.
   */
  private async ensureKit(
    scope: BrandKitScope,
    userId: string | null,
  ): Promise<BrandKitEntity> {
    const existing = await this.findKit(scope);
    if (existing) return existing;

    await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(BrandKitEntity)
      .values({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        palette: [],
        typography: [],
        guidelines: null,
        createdById: userId,
        updatedById: userId,
      })
      .orIgnore()
      .execute();

    const created = await this.findKit(scope);
    if (!created) {
      // Only reachable if the insert was rejected for a reason other than the
      // uniqueness conflict it is allowed to lose.
      throw new BadRequestException(
        'Não foi possível preparar o Brand Kit deste contexto.',
      );
    }

    return created;
  }

  private findKit(scope: BrandKitScope): Promise<BrandKitEntity | null> {
    return this.kits.findOne({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId ?? IsNull(),
      },
    });
  }

  /**
   * `withDeleted: false` is TypeORM's default for an entity with a
   * `@DeleteDateColumn`, and it is stated explicitly here because it is a
   * correctness rule, not an incidental default: an asset whose delete is
   * mid-flight (tombstoned, bytes possibly still in the bucket) must never
   * be listed again.
   */
  private listKitAssets(
    brandKitId: string,
    scope: BrandKitScope,
  ): Promise<BrandKitAssetEntity[]> {
    return this.assets.find({
      where: {
        brandKitId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId ?? IsNull(),
      },
      withDeleted: false,
      order: { kind: 'ASC', createdAt: 'ASC' },
    });
  }

  private resolveScope(
    ctx: RequestContext,
    agencyClientId: string | null,
  ): BrandKitScope {
    if (!ctx.tenantId) {
      throw new BadRequestException('Tenant context is required.');
    }
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }

    return {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      agencyClientId,
    };
  }

  /**
   * Removes a private object, treating "already absent" as success.
   *
   * A delete whose object is gone IS a completed delete — requiring the
   * object to exist would make a retry after a partial failure impossible,
   * which is the opposite of what the retry is for. Any other storage error
   * propagates: the caller must not report a physical removal that did not
   * happen.
   */
  private async removePrivateObject(objectKey: string): Promise<void> {
    try {
      await this.filesService.deleteObject({
        bucket: 'private',
        path: objectKey,
      });
    } catch (error) {
      if (isObjectAlreadyGone(error)) {
        return;
      }

      this.logger.error(
        `Brand Kit delete: failed to remove private object "${objectKey}". ` +
          `The metadata row is kept (tombstoned, storage_path intact) so the ` +
          `binary remains traceable and the delete can be retried. ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
      );
      throw error;
    }
  }

  /**
   * Storage removal that must NOT turn a failed operation into a different
   * failure. Used only to roll back an upload whose metadata write failed:
   * the error the caller is about to rethrow is the real one, and losing it
   * behind a cleanup error would hide why the upload failed. Unlike delete,
   * nothing here has been promised to the user yet.
   */
  private async bestEffortRemoveObject(
    objectKey: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.filesService.deleteObject({
        bucket: 'private',
        path: objectKey,
      });
    } catch (error) {
      this.logger.error(
        `Brand Kit ${reason}: failed to remove private object "${objectKey}". ` +
          `It is now orphaned and must be reconciled. ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
      );
    }
  }
}

/**
 * True when storage says the object is not there. Both shapes are handled
 * because the path crosses two layers: `FilesService` maps a 404/`NoSuchKey`
 * to `NotFoundException`, while a driver error may still arrive raw.
 */
function isObjectAlreadyGone(error: unknown): boolean {
  if (error instanceof NotFoundException) return true;

  const name = (error as { name?: string })?.name;
  if (name === 'NoSuchKey' || name === 'NotFound') return true;

  const statusCode = (error as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata?.httpStatusCode;
  return statusCode === 404;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
