import { ForbiddenException } from '@nestjs/common';
import type {
  ClientAreaAccessLevel,
  ClientAreaContext,
  ClientAreaModuleKey,
} from '../../client-area/client-area.types';
import type { LeadFlowOperationsActionIntent } from '../entities';
import {
  LeadFlowOperationsActionAccessService,
  leadFlowActionAccessOf,
  operationsActionRequirement,
} from './leadflow-operations-action-access.service';

const ID = '00000000-0000-4000-8000-0000000000aa';
const EXECUTABLE: LeadFlowOperationsActionIntent[] = [
  'pause_agent',
  'activate_agent',
  'create_contact',
  'move_opportunity',
  'update_contact_fields',
  'create_appointment',
];

function harness() {
  const permissions = { assertAny: jest.fn().mockResolvedValue(undefined) };
  const scopes = {
    assertClientAreaScope: jest.fn().mockResolvedValue(undefined),
  };
  const service = new LeadFlowOperationsActionAccessService(
    permissions as never,
    scopes as never,
  );
  const client = (
    module: ClientAreaModuleKey,
    level: ClientAreaAccessLevel | null,
  ) => ({
    kind: 'client_area' as const,
    context: {
      memberAccess: { [module]: { available: level !== null, level } },
    } as unknown as ClientAreaContext,
  });
  return { permissions, scopes, service, client };
}

describe('OR5 LeadFlowOperationsActionAccessService', () => {
  it('maps every executable intent to the keys of its route, and legacy rules to none', () => {
    expect(
      operationsActionRequirement('pause_agent', ID, false)?.agency,
    ).toEqual({
      method: 'POST',
      routePath: '/leadflow/agents/:id/pause',
      params: { id: ID },
      anyOf: ['leadflow.agents.agent.deactivate.admin'],
    });
    expect(
      operationsActionRequirement('move_opportunity', ID, true)?.agency.anyOf,
    ).toEqual([
      'leadflow.crm.records.update.assigned',
      'leadflow.crm.records.update.client',
    ]);
    expect(
      operationsActionRequirement('update_contact_fields', ID, true)
        ?.clientArea,
    ).toMatchObject({
      routePath: '/agency/contacts/leadflow/company-contacts/:contactId',
      params: { contactId: ID },
    });
    expect(
      operationsActionRequirement('create_contact', null, false)?.agency
        .routePath,
    ).toBe('/agency/contacts/leadflow');
    for (const legacy of ['add_closure', 'update_offer_price'] as const)
      expect(operationsActionRequirement(legacy, null, false)).toBeNull();
  });

  it('Agency: delegates to assertAny with the route, params and body', async () => {
    const h = harness();
    const access = {
      kind: 'agency' as const,
      permission: { tenantId: 't', userId: 'u', role: 'member' },
    };
    await h.service.assert(
      access,
      operationsActionRequirement('move_opportunity', ID, false)!,
      { stageId: ID },
    );
    expect(h.permissions.assertAny).toHaveBeenCalledWith(
      access.permission,
      [
        'leadflow.crm.records.update.assigned',
        'leadflow.crm.records.update.client',
      ],
      {
        method: 'PATCH',
        routePath: '/crm/opportunities/:id/stage',
        params: { id: ID },
        query: {},
        body: { stageId: ID },
      },
    );
  });

  // Client Area matrix: intent × level. Only the level projection decides;
  // no Agency role applies. `own` = created_by_me grant (operator updates).
  const matrix: Array<
    [
      LeadFlowOperationsActionIntent,
      ClientAreaModuleKey,
      Record<string, 'deny' | 'client' | 'own'>,
    ]
  > = [
    [
      'pause_agent',
      'leadflow_agents',
      { viewer: 'deny', operator: 'deny', manager: 'client' },
    ],
    [
      'activate_agent',
      'leadflow_agents',
      { viewer: 'deny', operator: 'deny', manager: 'client' },
    ],
    [
      'create_contact',
      'leadflow_crm',
      { viewer: 'deny', operator: 'client', manager: 'client' },
    ],
    [
      'update_contact_fields',
      'leadflow_crm',
      { viewer: 'deny', operator: 'own', manager: 'client' },
    ],
    [
      'move_opportunity',
      'leadflow_crm',
      { viewer: 'deny', operator: 'own', manager: 'client' },
    ],
    [
      'create_appointment',
      'leadflow_appointments',
      { viewer: 'deny', operator: 'client', manager: 'client' },
    ],
  ];
  it.each(matrix)('Client Area %s on %s', async (intent, module, expected) => {
    expect(EXECUTABLE).toContain(intent);
    for (const [level, outcome] of Object.entries(expected)) {
      const h = harness();
      const run = h.service.assert(
        h.client(module, level as ClientAreaAccessLevel),
        operationsActionRequirement(intent, ID, true)!,
      );
      if (outcome === 'deny') {
        await expect(run).rejects.toBeInstanceOf(ForbiddenException);
        expect(h.scopes.assertClientAreaScope).not.toHaveBeenCalled();
        continue;
      }
      await run;
      const call = h.scopes.assertClientAreaScope.mock.calls[0] as unknown[];
      expect(call[1]).toBe(module);
      expect(call[4]).toBe(outcome === 'own');
    }
    // A module the member does not have denies at any level.
    const h = harness();
    await expect(
      h.service.assert(
        h.client(module, null),
        operationsActionRequirement(intent, ID, true)!,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the principal comes from the authenticated request only', () => {
    expect(
      leadFlowActionAccessOf({
        user: { sub: 'u', tenantId: 't', workspaceId: 'w', role: 'member' },
      } as never),
    ).toEqual({
      kind: 'agency',
      permission: {
        tenantId: 't',
        workspaceId: 'w',
        userId: 'u',
        role: 'member',
      },
    });
    expect(() =>
      leadFlowActionAccessOf({ user: { surface: 'client_area' } } as never),
    ).toThrow(ForbiddenException);
  });
});
