export enum AgencyClientStatus {
  Active = 'active',
  Onboarding = 'onboarding',
  Paused = 'paused',
  AtRisk = 'at_risk',
  Ended = 'ended',
  Archived = 'archived',
}

/**
 * Statuses in which a client can have products activated and use the Client
 * Area. Onboarding is the setup phase itself, and At risk is a relationship
 * flag (not a billing state), so neither blocks access. Delinquency blocking,
 * when enabled, must come from overdue invoices, not from this status.
 */
export function isOperableClientStatus(status: AgencyClientStatus): boolean {
  return (
    status === AgencyClientStatus.Active ||
    status === AgencyClientStatus.Onboarding ||
    status === AgencyClientStatus.AtRisk
  );
}
