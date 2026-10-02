import { Injectable } from '@nestjs/common';

/**
 * NTF-C1 §8/§9/§48 — the seam between the Notifications Core and the Client
 * Area identity stack.
 *
 * WHY THE CORE CANNOT JUST IMPORT THE CLIENT AREA
 * -----------------------------------------------
 * Sixteen modules import `NotificationsModule` (Finance, Projects, Tasks,
 * Inbox, Team Chat, …). If the core imported `ClientAreaModule`, every one of
 * them would transitively pull in the Client Area authentication stack and its
 * ESM `otplib` dependency — the exact failure AP3 documented when it kept its
 * surface in a separate module. The arrow has to run Client Area → core, never
 * back.
 *
 * So the core declares what it needs from that surface as a narrow contract,
 * and the Client Area side supplies it.
 *
 * WHY A REGISTRY AND NOT AN INJECTION TOKEN
 * -----------------------------------------
 * This is the one design decision NTF-C1 is not free to get wrong, because the
 * sprint began by *proving* the alternative broken. AP3 declared
 * `CLIENT_APPROVAL_NOTIFIER` as a token, injected it with
 * `@Optional() @Inject(TOKEN)` into a provider declared by
 * `SocialApprovalsModule`, and bound it in `ClientAreaApprovalsModule`. Nest
 * resolves a provider's dependencies in the module that *declares* the
 * provider, so the binding was never in scope: the injection landed as
 * `undefined`, the guard `if (!this.clientNotifications) return;` took the
 * early exit, and every client approval email from AP3 onward was dropped with
 * no error anywhere. `ap3-client-notifier-wiring.spec.ts` reproduces that.
 *
 * A registry cannot fail that way. It is a plain provider of *this* module, so
 * it always resolves; whether it holds an implementation is an observable fact
 * with a test on it, not an invisible property of the module graph. CCOM2
 * reached the same conclusion for the conversation card and this follows it
 * deliberately rather than inventing a third pattern.
 *
 * WHAT STAYS BEHIND THE PORT
 * --------------------------
 * Only what genuinely differs by surface (§54): who is an eligible recipient,
 * and what their email address is. Everything else in the pipeline —
 * deduplication, the three-level persistence, delivery records, unread — is
 * surface-agnostic and is *not* duplicated.
 */

/** A client recipient the Client Area surface vouches for, right now. */
export type ClientNotificationRecipient = {
  userId: string;
  /** Evidence of the authorization, never an actor (CA0 §S). */
  membershipId: string;
  companyContextId: string;
  /**
   * `user_security_settings.current_email` — the authenticated credential of
   * the Client Area identity. Never `Contact.email`, which is CRM data and
   * says nothing about who holds access today (§9). Null when the identity has
   * no usable address, which skips the email channel without skipping in-app.
   */
  email: string | null;
};

export type ClientNotificationAudienceQuery = {
  tenantId: string;
  workspaceId: string;
  companyContextId: string;
  /**
   * The Client Area permission a membership's role preset must grant to be in
   * this audience, e.g. `client_area.approvals.view`.
   */
  requiredPermission: string;
  /** The Client Area module that must be enabled for the company.  */
  requiredModule: string;
};

export type ClientNotificationSurface = {
  /**
   * Active memberships of the company that still pass the full chain:
   * membership status, role permission, module enabled, CRM eligibility,
   * company context. Re-evaluated at call time, never trusted from when the
   * membership was granted (§21).
   */
  resolveAudience(
    query: ClientNotificationAudienceQuery,
  ): Promise<ClientNotificationRecipient[]>;

  /**
   * Re-validates one already-known recipient immediately before a delivery or
   * an actionable realtime emit (§21). Returns null when access has since been
   * revoked — fail closed.
   */
  revalidate(
    query: ClientNotificationAudienceQuery & { userId: string },
  ): Promise<ClientNotificationRecipient | null>;
};

/**
 * The registry itself. Provided by `NotificationsModule`, so it is always in
 * the resolution context of the processor; filled on init by the module that
 * joins the two sides.
 */
@Injectable()
export class ClientNotificationSurfaceRegistry {
  private implementation: ClientNotificationSurface | null = null;

  register(implementation: ClientNotificationSurface): void {
    this.implementation = implementation;
  }

  /**
   * Null means the Client Area surface is not wired into this process. The
   * caller then has no client audience — which is degradation, and is
   * observable, unlike the token failure this replaces.
   */
  get(): ClientNotificationSurface | null {
    return this.implementation;
  }
}
