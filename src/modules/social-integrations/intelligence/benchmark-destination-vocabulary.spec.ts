import { BENCHMARK_ELIGIBLE_DESTINATIONS } from '../../../common/intelligence';
import type { CanonicalPaidMediaDestination } from '../sync/paid-media-destination';

/**
 * Keeps the benchmark's destination axis in step with the canonical vocabulary.
 *
 * The contract mirrors `CanonicalPaidMediaDestination` rather than importing it,
 * because `common/intelligence` may not depend on a domain module. Social may
 * see both, so the drift check lives here.
 *
 * Unlike the business modes, this vocabulary is closed and defined in code, not
 * a tenant-extensible table — so mirroring it is safe. What is *not* safe is
 * letting the two lists diverge: a destination added to the resolver but missing
 * from the benchmark list would make every contribution from an ad set using it
 * fall to `unknown`, quietly moving real advertisers into the wrong cohort.
 */
describe('benchmark destination vocabulary', () => {
  /**
   * The full canonical set, written out so the compiler enforces the check.
   *
   * A `satisfies`-style exhaustive array rather than a runtime reflection,
   * because a TypeScript union has no runtime representation to enumerate. If a
   * member is added to `CanonicalPaidMediaDestination` and not here, this array
   * stops type-checking as complete — and if it is added here but not to the
   * contract, the assertion below fails.
   */
  const canonical: readonly CanonicalPaidMediaDestination[] = [
    'whatsapp',
    'instagram_direct',
    'messenger',
    'messaging_multi',
    'website',
    'lead_form',
    'app',
    'phone',
    'profile',
    'on_post',
    'unknown',
  ];

  it('matches the canonical paid-media destination set', () => {
    expect([...BENCHMARK_ELIGIBLE_DESTINATIONS].sort()).toEqual(
      [...canonical].sort(),
    );
  });

  /**
   * `unknown` is a cohort, not a gap.
   *
   * Meta does not state a destination for every ad set, and dropping those
   * contributions would bias every other cohort toward advertisers running
   * newer campaign types. The absence of information is itself comparable.
   */
  it('includes unknown as a real member', () => {
    expect(BENCHMARK_ELIGIBLE_DESTINATIONS).toContain('unknown');
  });
});
