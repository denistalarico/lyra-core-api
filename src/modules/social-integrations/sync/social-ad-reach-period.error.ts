/**
 * Period reach measurement is switched off for this deployment.
 *
 * Distinct from a failure: nothing went wrong, the capability is simply not
 * enabled. It exists as an error rather than a silent no-op so that a *manual*
 * request gets a stated reason instead of a summary reporting zero measurements,
 * which is indistinguishable from an account with no delivery.
 *
 * Nothing in the read path ever sees this. The overview reads the cache table
 * directly and answers `periodReach: null` when the gate has kept it empty — a
 * dashboard must not fail because a measurement it can live without was not
 * taken.
 */
export class SocialAdReachMeasurementDisabledError extends Error {
  constructor() {
    super('Meta Ads period reach measurement is disabled for this deployment.');
    this.name = 'SocialAdReachMeasurementDisabledError';
  }
}
