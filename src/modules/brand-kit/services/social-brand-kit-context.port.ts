import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { FilesService } from '../../../common/files/files.service';
import { projectBrandKitAssetMetadata } from '../brand-kit-asset-metadata';
import {
  BrandKitAssetEntity,
  BrandKitEntity,
  type BrandKitAssetKind,
  type BrandKitAssetUsage,
  type BrandKitPaletteEntry,
  type BrandKitTypographyEntry,
} from '../entities';

export type SocialBrandKitScope = {
  tenantId: string;
  workspaceId: string;
  /** NULL identifies the agency context; a client id identifies that client. */
  agencyClientId: string | null;
  companyContextId: string | null;
};

export type SocialBrandKitAssetFilter = {
  kind?: BrandKitAssetKind | readonly BrandKitAssetKind[];
  usage?: BrandKitAssetUsage;
};

export type SocialBrandKitContextAsset = {
  id: string;
  kind: BrandKitAssetKind;
  usage: BrandKitAssetUsage;
  label?: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  metadata: Record<string, unknown>;
};

export type SocialBrandKitContext = {
  brandKitId: string | null;
  palette: BrandKitPaletteEntry[];
  typography: BrandKitTypographyEntry[];
  guidelines: string | null;
  assets: SocialBrandKitContextAsset[];
};

/**
 * Identity of one asset's binary for a consumer that must freeze WHICH bytes
 * it used (Creative Studio CS3.4.2). `checksum` is the sha256 recorded at
 * upload; no storage key, no URL.
 */
export type SocialBrandKitAssetBinaryIdentity = {
  id: string;
  kind: BrandKitAssetKind;
  usage: BrandKitAssetUsage;
  mimeType: string;
  byteSize: string;
  checksum: string | null;
};

/**
 * Read-only Brand Kit boundary for Social features. This is intentionally
 * separate from SocialBrandContextPort, which reads LeadFlow company facts.
 * Callers pass the already-authorized scope; browser headers are not consulted
 * here and this port has no write operation. Its one binary operation
 * (`readAssetContent`, CS3.4.2) reads through `FilesService` by the row's own
 * key, so a consumer never learns or builds a storage location.
 */
@Injectable()
export class SocialBrandKitContextPort {
  constructor(
    @InjectRepository(BrandKitEntity, 'agency')
    private readonly kits: Repository<BrandKitEntity>,
    @InjectRepository(BrandKitAssetEntity, 'agency')
    private readonly assets: Repository<BrandKitAssetEntity>,
    private readonly files: FilesService,
  ) {}

  /**
   * CS3.4.2 — binary identities of the given assets of THIS scope's kit
   * (company included). Unknown, other-scope and tombstoned ids are simply
   * absent from the answer, indistinguishable from each other.
   */
  async resolveAssets(
    scope: SocialBrandKitScope,
    ids: readonly string[],
  ): Promise<SocialBrandKitAssetBinaryIdentity[]> {
    if (!ids.length) return [];
    const rows = await this.scopedAssets(scope, ids);
    return rows.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      usage: asset.usage,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      checksum: asset.checksum,
    }));
  }

  /**
   * CS3.4.2 — the bytes of one asset of this scope's kit, for a background
   * consumer that has no request context (the generation worker). `null` when
   * the asset is not (or no longer) readable in the scope; a storage failure
   * propagates.
   */
  async readAssetContent(
    scope: SocialBrandKitScope,
    id: string,
  ): Promise<{
    mimeType: string;
    checksum: string | null;
    body: Buffer;
  } | null> {
    const [asset] = await this.scopedAssets(scope, [id]);
    if (!asset) return null;
    let file: Awaited<ReturnType<FilesService['getPrivateAsset']>>;
    try {
      file = await this.files.getPrivateAsset(asset.storagePath);
    } catch (error) {
      // Row present, object gone: as unreadable as a missing row.
      if (error instanceof NotFoundException) return null;
      throw error;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of file.body)
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string),
      );
    return {
      mimeType: asset.mimeType,
      checksum: asset.checksum,
      body: Buffer.concat(chunks),
    };
  }

  private async scopedAssets(
    scope: SocialBrandKitScope,
    ids: readonly string[],
  ): Promise<BrandKitAssetEntity[]> {
    const valid = ids.filter((id) => UUID.test(id));
    if (!valid.length) return [];
    const kit = await this.kits.findOne({ where: kitScopeWhere(scope) });
    if (!kit) return [];
    // TypeORM leaves tombstoned rows out by default (`deleted_at`): a delete
    // in progress is already unreadable here.
    return this.assets.find({
      where: {
        id: In(valid),
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId:
          scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
        brandKitId: kit.id,
      },
    });
  }

  async load(
    scope: SocialBrandKitScope,
    filter: SocialBrandKitAssetFilter = {},
  ): Promise<SocialBrandKitContext> {
    const kit = await this.kits.findOne({ where: kitScopeWhere(scope) });

    if (!kit) {
      return {
        brandKitId: null,
        palette: [],
        typography: [],
        guidelines: null,
        assets: [],
      };
    }

    const kind =
      typeof filter.kind === 'string'
        ? filter.kind
        : filter.kind
          ? In([...filter.kind])
          : undefined;
    const assets = await this.assets.find({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId:
          scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
        brandKitId: kit.id,
        ...(kind ? { kind } : {}),
        ...(filter.usage ? { usage: filter.usage } : {}),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
    });

    return {
      brandKitId: kit.id,
      palette: kit.palette ?? [],
      typography: kit.typography ?? [],
      guidelines: kit.guidelines ?? null,
      assets: assets.map((asset) => {
        const label =
          typeof asset.metadata?.label === 'string'
            ? asset.metadata.label.trim()
            : '';
        return {
          id: asset.id,
          kind: asset.kind,
          usage: asset.usage,
          ...(label ? { label } : {}),
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
          metadata: projectBrandKitAssetMetadata(asset.metadata),
        };
      }),
    };
  }
}

/** A malformed id must not reach the driver as a cast error. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function kitScopeWhere(scope: SocialBrandKitScope) {
  return {
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    agencyClientId:
      scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    companyContextId:
      scope.companyContextId === null ? IsNull() : scope.companyContextId,
  };
}
