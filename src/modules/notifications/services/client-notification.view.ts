import { NotificationRecipientEntity } from '../entities';
import {
  NotificationActionType,
  NotificationCategory,
  NotificationPriority,
} from '../enums';

/**
 * NTF-C1 §43 — the client-facing shape of a notification.
 *
 * BUILT FIELD BY FIELD, NEVER SPREAD
 * ----------------------------------
 * The Agency list item (`mapNotificationRecipientToListItem`) carries
 * `actorUserId`, `eventType`, `resourceType`/`resourceId`, `interestReason`
 * and `productKey`/`moduleKey` — the internal taxonomy, the recipient strategy
 * and the id of an Agency operator. Reusing it for the client surface and
 * deleting a few keys is the shape that leaks the next field somebody adds, so
 * this type is declared independently and every field is assigned explicitly.
 *
 * What is deliberately absent:
 *
 *   tenantId / workspaceId    internal topology
 *   actorUserId               an Agency operator's identity
 *   interestReason            recipient-strategy internals
 *   metadata / templateVars   the raw source event
 *   sourceEventId             the dedupe key of the internal pipeline
 *   eventType                 internal taxonomy; `category` is the public axis
 *
 * `companyContextId` IS present: a person may hold memberships in several
 * companies (§20), so the feed has to say which one a notification belongs to,
 * and the deep link needs it. It is an id the client already owns and already
 * sees in its own routes.
 */
export type ClientNotificationItem = {
  id: string;
  recipientId: string;

  title: string;
  body: string;
  category: NotificationCategory;
  priority: NotificationPriority;

  actionType: NotificationActionType;
  /** Always a Client Area route, or null. Never an Agency route (§16). */
  actionUrl: string | null;

  companyContextId: string;

  occurredAt: string;
  createdAt: string;

  seenAt: string | null;
  readAt: string | null;
  isSeen: boolean;
  isRead: boolean;
};

/**
 * An Agency route must never reach a client. The publisher writes the client
 * route into `metadata.clientActionUrl`; `notifications.action_url` keeps
 * holding the Agency one, because the same notification row serves both
 * audiences when the audience is `both`.
 *
 * Anything that is not a relative `/client-area/...` path becomes null rather
 * than being passed through — a notification without a button is a small loss,
 * while an Agency deep link in a client UI is a dead end that also discloses
 * internal structure.
 */
function clientActionUrl(metadata: Record<string, unknown>): string | null {
  const candidate = metadata.clientActionUrl;
  if (typeof candidate !== 'string') return null;
  const normalized = candidate.trim();
  return normalized.startsWith('/client-area/') ? normalized : null;
}

export function toClientNotificationItem(
  recipient: NotificationRecipientEntity,
  companyContextId: string,
): ClientNotificationItem {
  const notification = recipient.notification;
  const metadata = notification.metadata ?? {};

  const title =
    typeof metadata.clientTitle === 'string' && metadata.clientTitle.trim()
      ? metadata.clientTitle.trim()
      : notification.title;
  const body =
    typeof metadata.clientBody === 'string' && metadata.clientBody.trim()
      ? metadata.clientBody.trim()
      : notification.body;

  const actionUrl = clientActionUrl(metadata);

  return {
    id: notification.id,
    recipientId: recipient.id,

    title,
    body,
    category: notification.category,
    priority: notification.priority,

    // An action type without a usable client route would render a button that
    // goes nowhere.
    actionType: actionUrl
      ? notification.actionType
      : NotificationActionType.NONE,
    actionUrl,

    companyContextId,

    occurredAt: notification.occurredAt.toISOString(),
    createdAt: notification.createdAt.toISOString(),

    seenAt: recipient.seenAt?.toISOString() ?? null,
    readAt: recipient.readAt?.toISOString() ?? null,
    isSeen: Boolean(recipient.seenAt),
    isRead: Boolean(recipient.readAt),
  };
}

/**
 * The company a client notification belongs to.
 *
 * Read from the notification's own metadata, written by the publisher that
 * resolved the client audience for exactly that company. Null when absent,
 * which makes the notification non-actionable rather than guessing a company
 * — a wrong company here would mean a deep link into someone else's scope.
 */
export function companyContextIdOf(notification: {
  metadata: Record<string, unknown> | null;
}): string | null {
  const value = notification.metadata?.companyContextId;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
