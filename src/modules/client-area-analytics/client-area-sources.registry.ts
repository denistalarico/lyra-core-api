import type { RequestContext } from '../../common/context/request-context.interface';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type {
  ClientAreaContext,
  ClientAreaModuleKey,
} from '../client-area/client-area.types';
import type { ClientAreaCompanyScope } from '../client-area/client-area-company-hooks.registry';
export type AnalyticsReadQuery = {
  view?: 'overview' | 'series';
  socialChannel?:
    | 'facebook'
    | 'instagram'
    | 'meta_ads'
    | 'summary'
    | 'google_ads';
  from?: string;
  to?: string;
  connectionId?: string;
  facebookAssetId?: string;
  instagramAssetId?: string;
  channelId?: string;
  agentId?: string;
  businessMode?: string;
};
export type AnalyticsSourceInput = {
  scope: ClientAreaCompanyScope;
  userId: string;
  context?: ClientAreaContext;
  query: AnalyticsReadQuery;
  agencyContext?: RequestContext;
};
export type ClientAreaSource = {
  key: string;
  modules: readonly ClientAreaModuleKey[];
  ownerOnly?: boolean;
  read: (input: AnalyticsSourceInput) => Promise<unknown>;
};
/** Narrow runtime port; explicit init registration is exercised by the Nest wiring spec. */
@Injectable()
export class ClientAreaSourcesRegistry {
  private readonly entries = new Map<string, ClientAreaSource>();
  register(entry: ClientAreaSource) {
    if (this.entries.has(entry.key))
      throw new Error(`Duplicate analytics source: ${entry.key}`);
    this.entries.set(entry.key, entry);
  }
  get(key: string) {
    const source = this.entries.get(key);
    if (!source)
      throw new ServiceUnavailableException('Analytics source unavailable.');
    return source;
  }
}
export class AnalyticsSourceUnavailable extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}
