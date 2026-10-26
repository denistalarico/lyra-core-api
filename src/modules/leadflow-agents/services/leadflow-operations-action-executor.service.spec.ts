import type { LeadFlowOperationsActionEntity } from '../entities';
import { LeadFlowOperationsActionExecutorService } from './leadflow-operations-action-executor.service';

const ID = '00000000-0000-4000-8000-0000000000aa';
const STAGE = '00000000-0000-4000-8000-0000000000bb';

function harness() {
  const agents = {
    pauseUntil: jest
      .fn()
      .mockResolvedValue({ id: ID, status: 'paused', pausedUntil: 'x' }),
    activate: jest.fn().mockResolvedValue({ id: ID, status: 'active' }),
  };
  const crm = {
    patchOpportunityStage: jest.fn().mockResolvedValue({ id: ID }),
  };
  const contacts = {
    createLeadFlowContact: jest.fn().mockResolvedValue({ id: ID }),
    patchContact: jest.fn().mockResolvedValue({ id: ID }),
  };
  const agenda = { createAppointment: jest.fn().mockResolvedValue({ id: ID }) };
  const service = new LeadFlowOperationsActionExecutorService(
    agents as never,
    crm as never,
    contacts as never,
    agenda as never,
  );
  const ctx = { tenantId: 't', workspaceId: 'w', userId: 'u' };
  const action = (
    intent: LeadFlowOperationsActionEntity['intent'],
    payload: Record<string, unknown>,
    extra: Partial<LeadFlowOperationsActionEntity> = {},
  ) =>
    ({
      id: 'action-1',
      intent,
      payload,
      targetId: ID,
      effectiveUntil: null,
      timezone: 'America/Sao_Paulo',
      ...extra,
    }) as LeadFlowOperationsActionEntity;
  return { service, ctx, action, agents, crm, contacts, agenda };
}

describe('OR5 LeadFlowOperationsActionExecutorService', () => {
  it('runs each intent with the confirmer context and only the allowlisted fields', async () => {
    const h = harness();
    const until = new Date('2026-10-27T12:00:00.000Z');
    await h.service.execute(
      h.ctx,
      h.action('pause_agent', {}, { effectiveUntil: until }),
    );
    expect(h.agents.pauseUntil).toHaveBeenCalledWith(h.ctx, ID, until);

    await h.service.execute(
      h.ctx,
      h.action('move_opportunity', { stageId: STAGE }),
    );
    expect(h.crm.patchOpportunityStage).toHaveBeenCalledWith(
      h.ctx,
      ID,
      { stageId: STAGE, reasonCode: 'manual_stage_move' },
      { idempotencyKey: 'leadflow-ops-action:action-1' },
    );

    await h.service.execute(
      h.ctx,
      h.action('update_contact_fields', {
        fields: { jobTitle: 'CEO', ownerUserId: 'x', companyContactId: 'y' },
      }),
    );
    expect(h.contacts.patchContact).toHaveBeenCalledWith(h.ctx, ID, {
      jobTitle: 'CEO',
    });

    const created = await h.service.execute(
      h.ctx,
      h.action(
        'create_contact',
        { displayName: 'Maria', email: 'm@x.co', clientId: 'evil' },
        { targetId: null },
      ),
    );
    expect(h.contacts.createLeadFlowContact).toHaveBeenCalledWith(h.ctx, {
      type: 'person',
      displayName: 'Maria',
      email: 'm@x.co',
      phone: undefined,
    });
    expect(created.targetId).toBe(ID);

    await h.service.execute(
      h.ctx,
      h.action(
        'create_appointment',
        {
          title: 'Reunião',
          startAt: '2026-10-27T13:00:00.000Z',
          ownerUserId: 'x',
        },
        { targetId: null },
      ),
    );
    expect(h.agenda.createAppointment).toHaveBeenCalledWith(h.ctx, {
      type: 'meeting',
      title: 'Reunião',
      startAt: '2026-10-27T13:00:00.000Z',
      endAt: undefined,
      timezone: 'America/Sao_Paulo',
      contactId: undefined,
      sourceChannel: 'manual',
    });
  });

  it('refuses intents without a domain execution', async () => {
    const h = harness();
    await expect(
      h.service.execute(h.ctx, h.action('add_closure', {})),
    ).rejects.toThrow('has no domain execution');
  });
});
