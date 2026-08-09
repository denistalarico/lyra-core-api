import type { LeadFlowOperationsActionEntity } from '../entities';
import { projectLeadFlowOperationalRules } from './leadflow-operations-runtime-projection';

function action(
  overrides: Partial<LeadFlowOperationsActionEntity>,
): LeadFlowOperationsActionEntity {
  return {
    id: 'action-1',
    status: 'confirmed',
    intent: 'capacity_unavailable',
    resourceKey: 'reservations',
    payload: { resourceLabel: 'Reservas' },
    effectiveFrom: new Date('2026-08-09T00:00:00.000Z'),
    effectiveUntil: null,
    timezone: 'America/Sao_Paulo',
    confirmedAt: new Date('2026-08-09T10:00:00.000Z'),
    updatedAt: new Date('2026-08-09T10:00:00.000Z'),
    ...overrides,
  } as LeadFlowOperationsActionEntity;
}

describe('projectLeadFlowOperationalRules', () => {
  it('projects only confirmed, non-expired structured facts', () => {
    const projected = projectLeadFlowOperationalRules(
      [
        action({}),
        action({ id: 'pending', status: 'pending_confirmation' }),
        action({
          id: 'expired',
          effectiveUntil: new Date('2026-08-08T00:00:00.000Z'),
        }),
      ],
      new Date('2026-08-09T15:00:00.000Z'),
    );

    expect(projected).toEqual([
      expect.objectContaining({
        actionId: 'action-1',
        kind: 'availability',
        state: 'unavailable',
        resourceKey: 'reservations',
      }),
    ]);
  });

  it('lets the latest confirmation win for the same resource and period', () => {
    const unavailable = action({ id: 'unavailable' });
    const released = action({
      id: 'released',
      intent: 'capacity_released',
      confirmedAt: new Date('2026-08-09T11:00:00.000Z'),
    });

    expect(
      projectLeadFlowOperationalRules(
        [released, unavailable],
        new Date('2026-08-09T15:00:00.000Z'),
      ),
    ).toEqual([
      expect.objectContaining({ actionId: 'released', state: 'available' }),
    ]);
  });
});
