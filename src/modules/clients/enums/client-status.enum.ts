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
 * Area. Onboarding is the setup phase itself, so it must not be blocked.
 */
export function isOperableClientStatus(status: AgencyClientStatus): boolean {
  return (
    status === AgencyClientStatus.Active ||
    status === AgencyClientStatus.Onboarding
  );
}
