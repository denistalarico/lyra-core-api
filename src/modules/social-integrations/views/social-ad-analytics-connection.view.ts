// src/modules/social-integrations/views/social-ad-analytics-connection.view.ts
//
// The connection shape an *analytics* caller may see.
//
// Deliberately narrower than `SocialAdConnectionView`, and built by
// construction from named fields rather than by spreading or by omitting from
// the settings view. The settings screen answers "is this credential healthy,
// and what can I do about it?"; this one answers only "which account am I
// looking at, and is it still being updated?" — and it is reachable with a
// weaker permission, so it must not carry the extra answer.
//
// Absent on purpose: `hasCredential`, `tokenExpiresAt`, `scopes`,
// `externalBusinessId`, `availableAccounts`. Those describe the credential and
// the authorization, which is the settings screen's subject, not this one's.

import type {
  SocialAdAccountConnectionEntity,
  SocialAdConnectionStatus,
  SocialAdProvider,
} from '../entities/social-ad-account-connection.entity';
import { maskExternalAccountId } from './social-ad-connection.view';

export interface SocialAdAnalyticsConnectionView {
  id: string;
  provider: SocialAdProvider;

  /**
   * Raw stored status rather than the settings screen's derived `state`.
   *
   * `state` folds in token expiry to say "expiring", which is a prompt to go
   * re-authorize — an act this caller may well not be permitted to perform.
   * Analytics needs one distinction only: whether new data is still arriving.
   */
  connectionStatus: SocialAdConnectionStatus;

  accountName: string | null;

  /**
   * Masked, exactly as the settings view masks it.
   *
   * The full `act_…` id is an addressable Graph resource. That it is already
   * withheld from an admin-permission screen settles it for a weaker one.
   */
  maskedAccountId: string | null;

  /**
   * Needed to format money, and to name the calendar the period is measured
   * in. Both are properties of the account the numbers describe, not of the
   * credential that fetched them.
   */
  currency: string | null;
  timezone: string | null;

  /** When the pipeline last wrote for this connection; null if never. */
  lastSyncedAt: string | null;
}

/**
 * `authorization_method` is not exposed here.
 *
 * It distinguishes the internal System User connection from an ordinary Meta
 * login, which tells an operator where the credential lives. Useful on the
 * settings screen, where the operator administers it; on an analytics picker it
 * would only leak how this tenant is provisioned to a reader who cannot act on
 * it either way.
 */
export function toSocialAdAnalyticsConnectionView(
  connection: SocialAdAccountConnectionEntity,
): SocialAdAnalyticsConnectionView {
  return {
    id: connection.id,
    provider: connection.provider,
    connectionStatus: connection.connectionStatus,
    accountName: connection.accountName,
    maskedAccountId: maskExternalAccountId(connection.externalAccountId),
    currency: connection.currency,
    timezone: connection.timezone,
    lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
  };
}
