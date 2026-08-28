/**
 * What a provider told us about how an inbound message arrived.
 *
 * Deliberately not named for WhatsApp or for CTWA. The concept — "this message
 * exists because someone clicked something we can identify" — is not specific
 * to one channel, and the two Meta channels that do not send it today are the
 * reason the name matters: when Instagram or Messenger begins reporting a
 * referral, it should fill this type rather than motivate a second one.
 *
 * Every identifier is optional because the channels genuinely differ. What is
 * *not* optional is that at least one identifier is present — an observation
 * that identifies nothing is dropped at the ingestion boundary rather than
 * stored as a row asserting only that an ad was involved.
 */
export type InboundAttributionObservation = {
  /**
   * The provider's own id for the clicked object. For Meta this is
   * `referral.source_id`, which for `source_type: 'ad'` is the ad id — the
   * same identity space as `social_ad_entities.external_id`.
   */
  adId?: string | null;

  /**
   * The provider's click identifier (Meta: `referral.ctwa_clid`). The one
   * value that cannot be reconstructed from the ad hierarchy afterwards, which
   * is why it is preserved even though nothing reads it yet.
   */
  clickId?: string | null;

  /**
   * The surface the click came from — Meta sends `ad`, `post` or `page`. A
   * `post` referral means organic content, and its `adId` will not resolve
   * against the ad hierarchy. Keeping this is what makes that a known outcome
   * instead of a failed join.
   */
  sourceType?: string | null;
};

/**
 * True when the observation carries something that identifies a source.
 *
 * The single gate between "the provider sent a referral block" and "we have an
 * observation worth recording". Meta can send a referral with neither id.
 */
export function hasAttributionIdentifier(
  observation: InboundAttributionObservation | null | undefined,
): observation is InboundAttributionObservation {
  if (!observation) return false;
  return Boolean(observation.adId ?? observation.clickId);
}

/**
 * Reads an attribution observation out of a normalized message's metadata bag.
 *
 * The adapters have always written `metadata.referral`, and the agent
 * activation policy has always read it from there. This reads the same place
 * rather than requiring every adapter to be rewritten first: the typed field
 * is the contract, and this is the bridge for the channels still expressing it
 * as loose metadata.
 *
 * Anything that is not a string becomes null. A provider that sends a numeric
 * id would otherwise store `"[object Object]"` or a number that fails the join
 * against a varchar column.
 */
export function readAttributionObservation(
  metadata: Record<string, unknown> | undefined,
): InboundAttributionObservation | null {
  const referral = metadata?.referral;
  if (!referral || typeof referral !== 'object' || Array.isArray(referral)) {
    return null;
  }

  const source = referral as Record<string, unknown>;
  const observation: InboundAttributionObservation = {
    adId: readIdentifier(source.adId),
    clickId: readIdentifier(source.clickId),
    sourceType: readIdentifier(source.sourceType),
  };

  return hasAttributionIdentifier(observation) ? observation : null;
}

/**
 * Provider identifiers are opaque strings; the column is varchar(180).
 * Truncating silently would produce an id that looks valid and joins to
 * nothing, so an over-long value is rejected outright.
 */
function readIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 180) return null;
  return trimmed;
}
