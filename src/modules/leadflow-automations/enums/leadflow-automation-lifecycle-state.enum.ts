/**
 * Effective, user-facing state of an automation.
 *
 * This is DERIVED, never persisted. `LeadFlowAutomationStatus` records the
 * operator's *intent* (draft/active/paused/...); the lifecycle state answers the
 * only question the user actually cares about — "is this thing working, and if
 * not, why?". Deriving it means a row that was persisted as `active` before
 * dependency gating existed can never keep claiming to run.
 *
 * Precedence (highest first): deprecated > blocked_by_dependency >
 * requires_configuration > paused > active > ready > draft.
 */
export enum LeadFlowAutomationLifecycleState {
  /** Provisioned, never configured or published by the operator. */
  Draft = 'draft',

  /** Configuration is incomplete or invalid; the operator can fix it. */
  RequiresConfiguration = 'requires_configuration',

  /** Fully configured and eligible to be turned on — waiting on the operator. */
  Ready = 'ready',

  /** Turned on and genuinely executing. Unreachable until a runtime exists. */
  Active = 'active',

  /** Turned off by the operator; configuration preserved. */
  Paused = 'paused',

  /**
   * Structurally unable to run: a required platform capability is missing.
   * No configuration change can clear this — only the owning domain shipping.
   */
  BlockedByDependency = 'blocked_by_dependency',

  /** Last execution failed in a way that needs attention. */
  Error = 'error',

  /** Recipe withdrawn from the catalog; existing instances are read-only. */
  Deprecated = 'deprecated',
}
