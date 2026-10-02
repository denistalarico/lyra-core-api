import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
  NotificationRecipientSurface,
} from '../enums';

export type NotificationExplicitRecipient = {
  userId: string;
  interestReason: NotificationInterestReason;
  /**
   * NTF-C1 — which surface this person is addressed as. Omitted means
   * `AGENCY`, so every existing publisher keeps its behaviour untouched.
   */
  surface?: NotificationRecipientSurface;
};

/**
 * NTF-C1 §8 — how the processor finds the Client Area audience of an event.
 *
 * The publisher supplies the *question* (which company, which permission,
 * which module) and the Client Area surface answers it at processing time, so
 * recipients are resolved against live membership and CRM eligibility rather
 * than against whatever was true when the event was queued (§21).
 *
 * Agency recipients stay explicit, exactly as today. This is additive: an
 * event with no `clientAudience` has no client recipients.
 */
export type NotificationClientAudience = {
  companyContextId: string;
  requiredPermission: string;
  requiredModule: string;
  interestReason: NotificationInterestReason;
  /**
   * Client-side deep link, built by the publisher. Always a Client Area route
   * (§16) — an Agency route in a client notification is a dead end at best and
   * a leak of internal structure at worst. Kept separate from
   * `payload.actionUrl`, which remains the Agency one.
   */
  actionUrl?: string;
  /** Client-facing copy, when it should differ from the Agency wording. */
  title?: string;
  body?: string;
};

export type NotificationSourceEvent = {
  eventId: string;
  eventType: string;

  tenantId: string;
  workspaceId?: string | null;
  managedTenantId?: string | null;

  productKey: NotificationProductKey;
  moduleKey: string;

  actorType: NotificationActorType;
  actorUserId?: string | null;
  initiatedByUserId?: string | null;

  resourceType?: string | null;
  resourceId?: string | null;

  occurredAt: string;

  recipients?: NotificationExplicitRecipient[];

  /**
   * NTF-C1 — the Client Area audience of this event, resolved by the core at
   * processing time. Absent for every Agency-only event.
   */
  clientAudience?: NotificationClientAudience;

  payload: Record<string, unknown>;
};
