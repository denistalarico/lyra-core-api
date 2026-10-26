import { ForbiddenException } from '@nestjs/common';
import type { RequestContext } from '../../../common/context/request-context.interface';
import type { OrionAccess } from './orion-tool-access.service';
import { OrionProposalService } from './orion-proposal.service';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const A1 = '00000000-0000-4000-8000-0000000000a1';
const A2 = '00000000-0000-4000-8000-0000000000a2';
const OPP = '00000000-0000-4000-8000-0000000000b1';
const STAGE = '00000000-0000-4000-8000-0000000000b2';
const PIPE = '00000000-0000-4000-8000-0000000000b3';
const ctx: RequestContext = { tenantId: 't', workspaceId: 'w', userId: 'u' };
const access: OrionAccess = {
  kind: 'agency',
  permission: { tenantId: 't', userId: 'u', role: 'member' },
};
const run = {
  ctx,
  access,
  requestText: 'pausa a Ana até sexta',
  idempotencyKey: 'orion:r:0',
};

function setup(readAllowed = true) {
  const actions = {
    propose: jest.fn(
      (_ctx: unknown, dto: { intent: string; payload?: unknown }) =>
        Promise.resolve({
          id: '00000000-0000-4000-8000-0000000000ff',
          intent: dto.intent,
          status: 'pending_confirmation',
          revision: 1,
          canConfirm: true,
          validationIssues: [],
          preview: { title: 'Pausar agente', summary: 'Pausar Ana até sex.' },
          effectiveFrom: null,
          effectiveUntil: null,
          timezone: 'America/Sao_Paulo',
        }),
    ),
  };
  const agents = {
    list: jest.fn().mockResolvedValue({
      items: [
        { id: A1, name: 'Ana', archivedAt: null, deletedAt: null },
        { id: A2, name: 'Ana Paula', archivedAt: null, deletedAt: null },
      ],
    }),
  };
  const crm = {
    listOpportunities: jest
      .fn()
      .mockResolvedValue([{ id: OPP, title: 'Maria Souza', pipelineId: PIPE }]),
    listStages: jest
      .fn()
      .mockResolvedValue([{ id: STAGE, name: 'Proposta', pipelineId: PIPE }]),
  };
  const contacts = { listContacts: jest.fn().mockResolvedValue({ items: [] }) };
  const toolAccess = { allowed: jest.fn().mockResolvedValue(readAllowed) };
  const service = new OrionProposalService(
    actions as never,
    agents as never,
    crm as never,
    contacts as never,
    toolAccess as never,
    { timeZone: 'America/Sao_Paulo' } as never,
  );
  return { service, actions, agents, crm, contacts, toolAccess };
}

describe('OR5 OrionProposalService', () => {
  it('resolves names under the caller scope and proposes without an agent', async () => {
    const h = setup();
    const out = await h.service.propose(
      'pause_agent',
      { agent: 'ana', until: '2026-10-30T18:00:00-03:00' },
      run,
    );
    expect(h.actions.propose).toHaveBeenCalledWith(
      ctx,
      {
        intent: 'pause_agent',
        requestText: run.requestText,
        idempotencyKey: 'orion:r:0',
        payload: {
          targetAgentId: A1,
          targetAgentName: 'Ana',
          effectivePeriod: { endsAt: '2026-10-30T18:00:00-03:00' },
          timezone: 'America/Sao_Paulo',
        },
      },
      access,
    );
    expect(out.proposal?.id).toBeDefined();
    // The model receives the card text, never record IDs.
    expect(JSON.stringify(out.payload)).not.toMatch(UUID);
  });

  it('asks back on ambiguous or unknown names, without proposing', async () => {
    const h = setup();
    await expect(
      h.service.propose('activate_agent', { agent: 'an' }, run),
    ).resolves.toEqual({
      payload: { error: 'agent_ambiguous', candidates: ['Ana', 'Ana Paula'] },
    });
    await expect(
      h.service.propose('activate_agent', { agent: 'Zeca' }, run),
    ).resolves.toMatchObject({ payload: { error: 'agent_not_found' } });
    expect(h.actions.propose).not.toHaveBeenCalled();
  });

  it('name lookups need the read permission of the records they search', async () => {
    const h = setup(false);
    await expect(
      h.service.propose(
        'move_opportunity',
        { opportunity: 'Maria', stage: 'Proposta' },
        run,
      ),
    ).resolves.toMatchObject({ payload: { error: 'permission_denied' } });
    expect(h.crm.listOpportunities).not.toHaveBeenCalled();
    await expect(
      h.service.propose('update_contact_fields', { contact: 'Maria' }, run),
    ).resolves.toMatchObject({ payload: { error: 'permission_denied' } });
    expect(h.contacts.listContacts).not.toHaveBeenCalled();
  });

  it('moves resolve the stage inside the opportunity pipeline', async () => {
    const h = setup();
    await h.service.propose(
      'move_opportunity',
      { opportunity: 'maria souza', stage: 'proposta' },
      run,
    );
    expect(h.crm.listStages).toHaveBeenCalledWith(ctx, PIPE);
    expect(h.actions.propose.mock.calls[0][1].payload).toMatchObject({
      opportunityId: OPP,
      stageId: STAGE,
      pipelineId: PIPE,
    });
  });

  it('a refused proposal returns a code, never the exception message', async () => {
    const h = setup();
    h.actions.propose.mockRejectedValueOnce(
      new ForbiddenException('segredo do tenant'),
    );
    const out = await h.service.propose(
      'create_contact',
      { name: 'Maria' },
      run,
    );
    expect(out).toEqual({ payload: { error: 'permission_denied' } });
  });
});
