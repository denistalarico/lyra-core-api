import {
  SOCIAL_PUBLICATION_STATUSES,
  SOCIAL_PUBLICATION_TERMINAL_STATUSES,
  SocialPublicationStatus,
  canTransition,
} from './social-publication.state';

const EXPECTED_TRANSITIONS: Readonly<
  Record<SocialPublicationStatus, readonly SocialPublicationStatus[]>
> = {
  draft: ['scheduled'],
  scheduled: ['queued', 'cancelled'],
  queued: ['processing', 'cancelled'],
  processing: ['published', 'queued', 'failed'],
  published: [],
  failed: [],
  cancelled: [],
};

describe('social publication state machine', () => {
  it.each(
    SOCIAL_PUBLICATION_STATUSES.flatMap((from) =>
      SOCIAL_PUBLICATION_STATUSES.map((to) => [from, to] as const),
    ),
  )('classifies %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(
      EXPECTED_TRANSITIONS[from].includes(to),
    );
  });

  it.each(SOCIAL_PUBLICATION_TERMINAL_STATUSES)(
    'allows no outgoing transition from terminal state %s',
    (terminal) => {
      for (const target of SOCIAL_PUBLICATION_STATUSES) {
        expect(canTransition(terminal, target)).toBe(false);
      }
    },
  );
});
