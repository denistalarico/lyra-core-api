import { BadRequestException, Injectable } from '@nestjs/common';
import { SocialAdCredentialResolver } from '../../social-integrations';
import { MetaAdsGraphService } from '../../social-integrations/services/meta-ads-graph.service';
import type { SocialBoostTargetingQueryDto } from '../dto';
import type { SocialCampaignsScope } from './social-boost-template.service';

type TargetingKind = SocialBoostTargetingQueryDto['kind'];
type ProviderRow = Record<string, unknown>;

export type SocialBoostTargetingOption = {
  id: string;
  label: string;
  kind: 'region' | 'city' | 'postal_code' | 'interest' | 'language' | 'saved_audience';
  detail: string | null;
};

/**
 * Resolves user-facing searches through the account's own Marketing API
 * credential. The browser never sees an Ads token and only receives canonical
 * provider identifiers that can be persisted in a Boost template.
 */
@Injectable()
export class MetaAdsBoostTargetingService {
  constructor(
    private readonly credentials: SocialAdCredentialResolver,
    private readonly graph: MetaAdsGraphService,
  ) {}

  async search(scope: SocialCampaignsScope, dto: SocialBoostTargetingQueryDto) {
    const credential = await this.credentials.resolve({ ...scope, connectionId: dto.connectionId });
    const query = dto.query?.trim() ?? '';
    if (dto.kind !== 'saved_audience' && query.length < 2) {
      throw new BadRequestException('Search must contain at least two characters.');
    }

    const page = dto.kind === 'saved_audience'
      ? await this.graph.readEdge({
          accessToken: credential.accessToken,
          path: `${credential.externalAccountId}/saved_audiences`,
          fields: 'id,name',
          limit: 25,
          maxPages: 1,
          failureMessage: 'Meta saved audiences could not be loaded.',
        })
      : await this.graph.readEdge({
          accessToken: credential.accessToken,
          path: `${credential.externalAccountId}/targetingsearch`,
          fields: 'id,key,name,type,country_code,region',
          params: { type: this.providerType(dto.kind), q: query },
          limit: 25,
          maxPages: 1,
          failureMessage: 'Meta targeting options could not be loaded.',
        });

    return {
      items: page.rows
        .filter((row): row is ProviderRow => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
        .map((row) => this.toOption(dto.kind, row))
        .filter((row): row is SocialBoostTargetingOption => row !== null),
      isPartial: page.truncated,
    };
  }

  private providerType(kind: Exclude<TargetingKind, 'saved_audience'>) {
    return kind === 'location' ? 'adgeolocation' : kind === 'interest' ? 'adinterest' : 'adlocale';
  }

  private toOption(kind: TargetingKind, row: ProviderRow): SocialBoostTargetingOption | null {
    const id = this.string(row.key) ?? this.string(row.id);
    const label = this.string(row.name);
    if (!id || !label || !/^\d+$/.test(id)) return null;
    if (kind === 'location') {
      const providerType = this.string(row.type)?.toLowerCase();
      const optionKind = providerType === 'region' ? 'region' : providerType === 'zip' || providerType === 'postal_code' ? 'postal_code' : 'city';
      const detail = [this.string(row.region), this.string(row.country_code)].filter(Boolean).join(' · ') || null;
      return { id, label, kind: optionKind, detail };
    }
    return { id, label, kind: kind === 'interest' ? 'interest' : kind === 'language' ? 'language' : 'saved_audience', detail: null };
  }

  private string(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
}
