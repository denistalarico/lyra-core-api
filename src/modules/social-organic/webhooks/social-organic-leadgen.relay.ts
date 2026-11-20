import { Injectable } from '@nestjs/common';
import {
  type MetaWebhookChange,
  readExternalId,
  readUnixSeconds,
} from './meta/meta-organic-webhook.parser';

/**
 * ML1 (D-L7): `page` / `leadgen`.
 *
 * Unlike the four interaction fields, a `leadgen` change is not an organic
 * interaction and is not stored as one. The value carries only ids, so the lead
 * itself has to be read from Graph and routed to a Forms form — two outbound
 * edges this directory must never have (`meta-organic-webhook.boundary.spec`).
 *
 * So the webhook only **relays**: it parses the ids here (pure), resolves the
 * scope from `entry[].id` like every other change, and hands both to the one
 * sink that registered on boot (the Forms module). The arrow stays
 * forms → social-organic; this module never imports Forms.
 */

export type MetaLeadgenNotification = {
  leadgenId: string;
  pageId: string;
  formId: string | null;
  adId: string | null;
  adgroupId: string | null;
  createdAt: Date | null;
};

export type MetaLeadgenScope = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId: string | null;
  /** `social_organic_assets.id` of the Page. */
  assetId: string;
};

/** Same three outcomes the worker settles a change with. */
export type MetaLeadgenOutcome =
  | { kind: 'processed' }
  | { kind: 'unhandled'; safeErrorCode: string }
  | { kind: 'failed'; safeErrorCode: string };

export type MetaLeadgenSink = (input: {
  scope: MetaLeadgenScope;
  notification: MetaLeadgenNotification;
  sourceWebhookEventId: string;
}) => Promise<MetaLeadgenOutcome>;

/** Object/field pairs that are relayed instead of normalized into interactions. */
export function isRelayedLeadgen(
  objectType: string,
  field: string | null,
): boolean {
  return objectType === 'page' && field === 'leadgen';
}

/**
 * Documented value: `{ leadgen_id, page_id, form_id, ad_id, adgroup_id,
 * created_time }`. Only `leadgen_id` is required: without it there is nothing
 * to read. `page_id` falls back to the entry id (the Page itself).
 */
export function parseMetaLeadgenChange(
  change: MetaWebhookChange,
): MetaLeadgenNotification | null {
  const value = change.value;
  if (!value) return null;
  const leadgenId = readExternalId(value.leadgen_id);
  const pageId = readExternalId(value.page_id) ?? change.externalAssetId;
  if (!leadgenId || !pageId) return null;
  return {
    leadgenId,
    pageId,
    formId: readExternalId(value.form_id),
    adId: readExternalId(value.ad_id),
    adgroupId: readExternalId(value.adgroup_id),
    createdAt: readUnixSeconds(value.created_time),
  };
}

@Injectable()
export class SocialOrganicLeadgenRelay {
  private sink: MetaLeadgenSink | null = null;

  /** One sink per process; the last registration wins. */
  register(sink: MetaLeadgenSink): void {
    this.sink = sink;
  }

  async relay(
    input: Parameters<MetaLeadgenSink>[0],
  ): Promise<MetaLeadgenOutcome> {
    if (!this.sink) {
      return { kind: 'unhandled', safeErrorCode: 'no_handler_registered' };
    }
    return this.sink(input);
  }
}
