/** Lifecycle status of an event contract in the catalog. */
export enum LeadFlowEventStatus {
  /** Contract is stable and accepted by the durable delivery runtime. */
  Active = 'active',
  /** Contract is foreseen (e.g. automation execution events) but deferred. */
  Planned = 'planned',
  /** Contract kept for compatibility; new emitters must not use it. */
  Deprecated = 'deprecated',
}
