/**
 * One hour's online-follower reading, normalized, ready to be written.
 *
 * `metricDate` and `hourOfDay` are in `sourceTimezone` — Pacific, as Meta
 * indexes this metric — and not in `assetTimezone`. Both travel together so the
 * read layer can convert; see the entity for why the conversion is not done on
 * the way in.
 *
 * `followersOnline` is a STOCK. Summing it across hours or days does not give a
 * number of people, because one follower online for three hours appears in
 * three rows.
 */
export type NormalizedOrganicOnlineFollowers = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  assetId: string;
  provider: string;
  /** Calendar day in `sourceTimezone`. */
  metricDate: string;
  /** 0–23 in `sourceTimezone`. */
  hourOfDay: number;
  assetTimezone: string;
  sourceTimezone: string;
  followersOnline: string;
  observedAt: Date;
  syncedAt: Date;
  syncRunId: string;
};

/** What one asset's online-followers pass did. */
export type SocialOrganicOnlineFollowersSyncSummary = {
  rowsWritten: number;
  /** Days Meta actually carried data for, out of the window requested. */
  daysCovered: number;
  apiCalls: number;
};
