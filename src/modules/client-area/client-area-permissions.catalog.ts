import type {
  ClientAreaPermissionKey,
  ClientAreaRole,
} from './client-area.types';

/**
 * CA1 — Client Area role presets (CA0 §G/§H).
 *
 * A separate catalog on purpose: everything in the Agency
 * `PERMISSION_DEFINITIONS` joins the Agency role matrix and is granted to the
 * Agency Owner automatically. These keys must never be reachable from there,
 * and there is no bypass for `client_admin` — every role gets exactly its
 * preset. Overrides per person are out of scope until a product case exists.
 */
export const CLIENT_AREA_ROLE_PERMISSIONS: Readonly<
  Record<ClientAreaRole, readonly ClientAreaPermissionKey[]>
> = Object.freeze({
  client_admin: Object.freeze([
    'client_area.approvals.view',
    'client_area.approvals.comment',
    'client_area.approvals.decide',
    'client_area.conversations.view',
    'client_area.conversations.send',
    'client_area.self.overview.view',
  ] as const),
  client_operator: Object.freeze([
    'client_area.approvals.view',
    'client_area.approvals.comment',
    'client_area.approvals.decide',
    'client_area.conversations.view',
    'client_area.conversations.send',
    'client_area.self.overview.view',
  ] as const),
  // CCOM1 §18 — a viewer reads the thread but cannot send. Note this differs
  // from approvals, where a viewer may comment: an approval comment is scoped
  // to one artefact under review, while a conversation message is an open
  // channel to the agency, so the write there is the operator's call.
  client_viewer: Object.freeze([
    'client_area.approvals.view',
    'client_area.approvals.comment',
    'client_area.conversations.view',
    // PD4 — a viewer reads the overview. The surface is read-only by nature,
    // so there is no narrower variant to withhold; the gate that matters for
    // the self-context is self access itself (PD3 §7), re-evaluated per
    // request, not a split between reading and acting on a number.
    'client_area.self.overview.view',
  ] as const),
});

export function permissionsForClientAreaRole(
  role: ClientAreaRole,
): ReadonlySet<ClientAreaPermissionKey> {
  return new Set(CLIENT_AREA_ROLE_PERMISSIONS[role]);
}
