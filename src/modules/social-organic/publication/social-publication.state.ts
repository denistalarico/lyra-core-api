export const SOCIAL_PUBLICATION_STATUSES = [
  'draft',
  'scheduled',
  'queued',
  'processing',
  'published',
  'failed',
  'cancelled',
] as const;

export type SocialPublicationStatus =
  (typeof SOCIAL_PUBLICATION_STATUSES)[number];

export const SOCIAL_PUBLICATION_TERMINAL_STATUSES = [
  'published',
  'failed',
  'cancelled',
] as const satisfies readonly SocialPublicationStatus[];

const ALLOWED_TRANSITIONS: Readonly<
  Record<SocialPublicationStatus, ReadonlySet<SocialPublicationStatus>>
> = {
  draft: new Set(['scheduled']),
  scheduled: new Set(['queued', 'cancelled']),
  queued: new Set(['processing', 'cancelled']),
  processing: new Set(['published', 'queued', 'failed']),
  published: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

/** Pure state-machine guard. Persistence and side effects belong to callers. */
export function canTransition(
  from: SocialPublicationStatus,
  to: SocialPublicationStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}
