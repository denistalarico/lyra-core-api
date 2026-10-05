import { Injectable } from '@nestjs/common';
import {
  SocialBrandKitContextPort,
  type SocialBrandKitContextAsset,
} from '../brand-kit/services/social-brand-kit-context.port';
import type { CreativeStudioScope } from './creative-studio.scope';

export type CreativeStudioBrandContext = {
  palette: Awaited<ReturnType<SocialBrandKitContextPort['load']>>['palette'];
  typography: Awaited<
    ReturnType<SocialBrandKitContextPort['load']>
  >['typography'];
  guidelines: string | null;
  assets: SocialBrandKitContextAsset[];
  references: SocialBrandKitContextAsset[];
};

/**
 * Read-only Creative Studio view of the canonical Brand Kit. The port has
 * already projected safe metadata; this service only creates the deterministic
 * production-oriented split between reusable assets and visual references.
 */
@Injectable()
export class CreativeStudioBrandContextService {
  constructor(private readonly brandKit: SocialBrandKitContextPort) {}

  async load(
    scope: CreativeStudioScope,
  ): Promise<CreativeStudioBrandContext> {
    const context = await this.brandKit.load(scope);

    return {
      palette: context.palette,
      typography: context.typography,
      guidelines: context.guidelines,
      assets: context.assets.filter((asset) => asset.usage === 'asset'),
      references: context.assets.filter(
        (asset) => asset.usage === 'reference',
      ),
    };
  }
}
