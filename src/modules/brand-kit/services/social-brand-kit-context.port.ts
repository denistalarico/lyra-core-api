import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
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
 * Read-only Brand Kit boundary for Social features. This is intentionally
 * separate from SocialBrandContextPort, which reads LeadFlow company facts.
 * Callers pass the already-authorized scope; browser headers are not consulted
 * here and this port has no write or binary-storage operation.
 */
@Injectable()
export class SocialBrandKitContextPort {
  constructor(
    @InjectRepository(BrandKitEntity, 'agency')
    private readonly kits: Repository<BrandKitEntity>,
    @InjectRepository(BrandKitAssetEntity, 'agency')
    private readonly assets: Repository<BrandKitAssetEntity>,
  ) {}

  async load(
    scope: SocialBrandKitScope,
    filter: SocialBrandKitAssetFilter = {},
  ): Promise<SocialBrandKitContext> {
    const kitWhere = {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
      companyContextId:
        scope.companyContextId === null ? IsNull() : scope.companyContextId,
    };
    const kit = await this.kits.findOne({ where: kitWhere });

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
