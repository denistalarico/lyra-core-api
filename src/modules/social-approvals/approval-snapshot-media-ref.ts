/** Slots of a snapshot: `file`, `item-0`, `item-0-thumb`. */
export const APPROVAL_SNAPSHOT_MEDIA_SLOT =
  /^(?:file|item-(\d{1,3})(-thumb)?)$/;

export function isApprovalSnapshotMediaRef(value: unknown): value is string {
  return typeof value === 'string' && APPROVAL_SNAPSHOT_MEDIA_SLOT.test(value);
}
