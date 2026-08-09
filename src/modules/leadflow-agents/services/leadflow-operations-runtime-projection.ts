import type { LeadFlowOperationsActionEntity } from '../entities';

export type LeadFlowOperationalRule = {
  actionId: string;
  kind: 'availability' | 'closure';
  state: 'unavailable' | 'available' | 'closed';
  resourceKey: string | null;
  resourceLabel: string | null;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  quantity: number | null;
  confirmedAt: string;
};

export function projectLeadFlowOperationalRules(
  actions: readonly LeadFlowOperationsActionEntity[],
  now = new Date(),
): LeadFlowOperationalRule[] {
  const effective = actions
    .filter(
      (action) =>
        action.status === 'confirmed' &&
        action.effectiveFrom !== null &&
        (action.effectiveUntil === null ||
          action.effectiveUntil.getTime() > now.getTime()),
    )
    .sort(
      (left, right) =>
        (left.confirmedAt?.getTime() ?? 0) -
        (right.confirmedAt?.getTime() ?? 0),
    );
  const byTarget = new Map<string, LeadFlowOperationalRule>();

  for (const action of effective) {
    const key = [
      action.resourceKey ?? action.intent,
      action.effectiveFrom?.toISOString() ?? '',
      action.effectiveUntil?.toISOString() ?? '',
    ].join(':');
    byTarget.set(key, {
      actionId: action.id,
      kind: action.intent === 'add_closure' ? 'closure' : 'availability',
      state:
        action.intent === 'capacity_released'
          ? 'available'
          : action.intent === 'add_closure'
            ? 'closed'
            : 'unavailable',
      resourceKey: action.resourceKey,
      resourceLabel: readString(action.payload.resourceLabel),
      startsAt: action.effectiveFrom!.toISOString(),
      endsAt: action.effectiveUntil?.toISOString() ?? null,
      timezone: action.timezone ?? 'UTC',
      quantity: readNumber(action.payload.quantity),
      confirmedAt:
        action.confirmedAt?.toISOString() ?? action.updatedAt.toISOString(),
    });
  }
  return [...byTarget.values()].sort((left, right) =>
    left.startsAt.localeCompare(right.startsAt),
  );
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
