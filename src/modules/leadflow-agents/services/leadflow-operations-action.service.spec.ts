import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { CompanyContextRequiredException } from '../../../common/context/company-aware-scope';
import type { DataSource, Repository } from 'typeorm';
import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { LeadFlowOperationsActionEntity } from '../entities';
import { LeadFlowOperationsActionEventEntity } from '../entities/leadflow-operations-action-event.entity';
import { LeadFlowOperationsActionService } from './leadflow-operations-action.service';
import type { LeadFlowAgentService } from './leadflow-agent.service';
import type {
  LeadFlowActionAccess,
  LeadFlowOperationsActionAccessService,
} from './leadflow-operations-action-access.service';
import type { LeadFlowOperationsActionExecutorService } from './leadflow-operations-action-executor.service';

const AGENT_ID = '00000000-0000-4000-8000-0000000000e1';
const OTHER_AGENT_ID = '00000000-0000-4000-8000-0000000000e2';
const OPPORTUNITY_ID = '00000000-0000-4000-8000-0000000000f1';
const STAGE_ID = '00000000-0000-4000-8000-0000000000f2';
const PIPELINE_ID = '00000000-0000-4000-8000-0000000000f3';

function createHarness() {
  const actions: LeadFlowOperationsActionEntity[] = [];
  const events: LeadFlowOperationsActionEventEntity[] = [];
  const settings = {
    id: '00000000-0000-4000-8000-000000000010',
    tenantId: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    contextType: LeadFlowSettingsContextType.Agency,
    agencyClientId: null,
    businessModeKey: 'restaurants_food',
  };
  const actionRepository = {
    create: (value: Partial<LeadFlowOperationsActionEntity>) =>
      value as LeadFlowOperationsActionEntity,
    save: async (value: LeadFlowOperationsActionEntity) => {
      const existing = actions.findIndex((item) => item.id === value.id);
      const saved = {
        ...value,
        id:
          value.id ??
          `00000000-0000-4000-8000-${String(actions.length + 20).padStart(12, '0')}`,
        createdAt: value.createdAt ?? new Date('2026-08-09T15:00:00.000Z'),
        updatedAt: new Date('2026-08-09T15:00:00.000Z'),
      } as LeadFlowOperationsActionEntity;
      if (existing >= 0) actions[existing] = saved;
      else actions.push(saved);
      return saved;
    },
    findOne: async ({ where }: { where: Record<string, unknown> }) =>
      actions.find(
        (item) =>
          (!where.id || item.id === where.id) &&
          (!where.idempotencyKey ||
            item.idempotencyKey === where.idempotencyKey),
      ) ?? null,
    find: async () => [...actions],
  };
  const eventRepository = {
    create: (value: Partial<LeadFlowOperationsActionEventEntity>) =>
      value as LeadFlowOperationsActionEventEntity,
    save: async (value: LeadFlowOperationsActionEventEntity) => {
      const saved = {
        ...value,
        id: `00000000-0000-4000-8000-${String(events.length + 50).padStart(12, '0')}`,
        createdAt: new Date('2026-08-09T15:00:00.000Z'),
      } as LeadFlowOperationsActionEventEntity;
      events.push(saved);
      return saved;
    },
  };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === LeadFlowOperationsActionEntity
        ? actionRepository
        : eventRepository,
  };
  const dataSource = {
    transaction: <T>(run: (value: typeof manager) => Promise<T>) =>
      run(manager),
  };
  const settingsRepository = {
    findOne: jest.fn().mockResolvedValue(settings),
  };
  const agentRows = new Map<string, Record<string, unknown>>([
    [
      AGENT_ID,
      {
        id: AGENT_ID,
        name: 'Ana',
        metadata: { allowedActions: ['send_message', 'capture_lead'] },
        crmPolicy: {},
      },
    ],
    [
      OTHER_AGENT_ID,
      {
        id: OTHER_AGENT_ID,
        name: 'Bia',
        metadata: { allowedActions: ['update_crm_stage'] },
        crmPolicy: { pipelineRef: { pipelineId: PIPELINE_ID } },
      },
    ],
  ]);
  const agents = {
    findScopedEntity: jest.fn((_ctx: unknown, id: string) => {
      const row = agentRows.get(id);
      return row
        ? Promise.resolve(row)
        : Promise.reject(new NotFoundException('Agente não encontrado.'));
    }),
  };
  const access = { assert: jest.fn().mockResolvedValue(undefined) };
  const executor = {
    execute: jest.fn((_ctx: unknown, action: LeadFlowOperationsActionEntity) =>
      Promise.resolve({
        targetId: action.targetId,
        result: { status: 'paused' },
      }),
    ),
  };
  const service = new LeadFlowOperationsActionService(
    dataSource as unknown as DataSource,
    settingsRepository as unknown as Repository<LeadFlowClientSettingsEntity>,
    actionRepository as unknown as Repository<LeadFlowOperationsActionEntity>,
    agents as unknown as LeadFlowAgentService,
    access as unknown as LeadFlowOperationsActionAccessService,
    executor as unknown as LeadFlowOperationsActionExecutorService,
  );
  const ctx = {
    tenantId: settings.tenantId,
    workspaceId: settings.workspaceId,
    userId: '00000000-0000-4000-8000-000000000003',
  };
  const principal: LeadFlowActionAccess = {
    kind: 'agency',
    permission: {
      tenantId: settings.tenantId,
      workspaceId: settings.workspaceId,
      userId: ctx.userId,
      role: 'manager',
    },
  };
  return {
    service,
    ctx,
    actions,
    events,
    settingsRepository,
    agents,
    access,
    executor,
    principal,
    agentRows,
  };
}

describe('LeadFlowOperationsActionService', () => {
  it('proposes and explicitly confirms a canonical availability operation', async () => {
    const harness = createHarness();
    const proposed = await harness.service.propose(
      harness.ctx,
      {
        intent: 'capacity_released',
        requestText: 'Liberou uma mesa sexta às 15h',
        idempotencyKey: 'message-1',
        payload: {
          timezone: 'America/Sao_Paulo',
          resourceRef: 'table_slot',
          resourceLabel: 'Mesa liberada',
          effectivePeriod: {
            startsAt: '2026-08-14T18:00:00.000Z',
            endsAt: '2026-08-14T19:00:00.000Z',
          },
        },
      },
      harness.principal,
    );

    expect(proposed.status).toBe('pending_confirmation');
    expect(proposed.canConfirm).toBe(true);
    expect(harness.events.map((event) => event.eventType)).toEqual([
      'proposed',
    ]);

    const confirmed = await harness.service.confirm(
      harness.ctx,
      proposed.id,
      { expectedRevision: proposed.revision },
      harness.principal,
    );

    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.revision).toBe(2);
    expect(confirmed.canConfirm).toBe(false);
    expect(harness.events.map((event) => event.eventType)).toEqual([
      'proposed',
      'confirmed',
    ]);
  });

  it('keeps an incomplete closure blocked from confirmation', async () => {
    const harness = createHarness();
    const proposed = await harness.service.propose(
      harness.ctx,
      {
        intent: 'add_closure',
        requestText: 'No próximo feriado não vamos abrir',
        idempotencyKey: 'message-2',
        payload: { timezone: 'America/Sao_Paulo' },
      },
      harness.principal,
    );

    expect(proposed.canConfirm).toBe(false);
    expect(proposed.validationIssues).toContain(
      'Informe quando a alteração começa.',
    );
    await expect(
      harness.service.confirm(
        harness.ctx,
        proposed.id,
        { expectedRevision: proposed.revision },
        harness.principal,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('OR3: resolves the company settings row by client and company, never the client alone', async () => {
    const harness = createHarness();
    const clientCtx = {
      ...harness.ctx,
      managedContext: {
        operatingMode: 'client',
        clientId: '00000000-0000-4000-8000-0000000000c1',
        companyContextId: '00000000-0000-4000-8000-0000000000a1',
      },
    } as unknown as RequestContext;
    await harness.service.list(clientCtx);
    expect(harness.settingsRepository.findOne).toHaveBeenLastCalledWith({
      where: {
        tenantId: harness.ctx.tenantId,
        workspaceId: harness.ctx.workspaceId,
        contextType: LeadFlowSettingsContextType.Client,
        agencyClientId: '00000000-0000-4000-8000-0000000000c1',
        companyContextId: '00000000-0000-4000-8000-0000000000a1',
      },
    });
    // Client mode without a company fails closed (CC2G) before any read.
    harness.settingsRepository.findOne.mockClear();
    await expect(
      harness.service.list({
        ...clientCtx,
        managedContext: {
          ...clientCtx.managedContext,
          companyContextId: null,
        },
      } as unknown as RequestContext),
    ).rejects.toBeInstanceOf(CompanyContextRequiredException);
    expect(harness.settingsRepository.findOne).not.toHaveBeenCalled();
  });

  describe('OR5 — executable proposals', () => {
    const future = () => new Date(Date.now() + 3 * 86_400_000).toISOString();

    it('Orion proposal: pause for a period runs only after the confirmer passes the pause route check', async () => {
      const harness = createHarness();
      const proposed = await harness.service.propose(
        harness.ctx,
        {
          intent: 'pause_agent',
          requestText: 'pausa a Bia até sexta',
          payload: {
            targetAgentId: OTHER_AGENT_ID,
            targetAgentName: 'Bia',
            timezone: 'America/Sao_Paulo',
            effectivePeriod: { endsAt: future() },
          },
        },
        harness.principal,
      );
      expect(proposed.canConfirm).toBe(true);
      expect(proposed.agentId).toBeNull();
      expect(proposed.targetType).toBe('agent');
      expect(harness.executor.execute).not.toHaveBeenCalled();

      const confirmed = await harness.service.confirm(
        harness.ctx,
        proposed.id,
        { expectedRevision: proposed.revision },
        harness.principal,
      );
      expect(confirmed.status).toBe('confirmed');
      expect(confirmed.result).toEqual({ status: 'paused' });
      expect(harness.executor.execute).toHaveBeenCalledTimes(1);
      const [, requirement] = harness.access.assert.mock.calls.at(-1) as [
        unknown,
        { agency: unknown },
      ];
      expect(requirement.agency).toEqual({
        method: 'POST',
        routePath: '/leadflow/agents/:id/pause',
        params: { id: OTHER_AGENT_ID },
        anyOf: ['leadflow.agents.agent.deactivate.admin'],
      });
      expect(harness.events.at(-1)?.snapshot).toMatchObject({
        targetId: OTHER_AGENT_ID,
        targetType: 'agent',
      });
    });

    it('a denied confirmer leaves the proposal pending and nothing runs', async () => {
      const harness = createHarness();
      const proposed = await harness.service.propose(
        harness.ctx,
        {
          intent: 'activate_agent',
          requestText: 'ativa a Bia',
          payload: { targetAgentId: OTHER_AGENT_ID, targetAgentName: 'Bia' },
        },
        harness.principal,
      );
      harness.access.assert.mockRejectedValueOnce(
        new ForbiddenException('Insufficient permissions.'),
      );
      await expect(
        harness.service.confirm(
          harness.ctx,
          proposed.id,
          { expectedRevision: proposed.revision },
          harness.principal,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(harness.executor.execute).not.toHaveBeenCalled();
      expect(harness.actions[0].status).toBe('pending_confirmation');
    });

    it('the proposer must hold the route permission to receive the proposal', async () => {
      const harness = createHarness();
      harness.access.assert.mockRejectedValueOnce(
        new ForbiddenException('Insufficient permissions.'),
      );
      await expect(
        harness.service.propose(
          harness.ctx,
          {
            intent: 'create_contact',
            requestText: 'cria o contato Maria',
            payload: { displayName: 'Maria Souza' },
          },
          harness.principal,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(harness.actions).toHaveLength(0);
    });

    it('agent scope: an agent only pauses itself', async () => {
      const harness = createHarness();
      await expect(
        harness.service.propose(
          harness.ctx,
          {
            intent: 'pause_agent',
            requestText: 'pausa a Bia',
            agentId: AGENT_ID,
            payload: { targetAgentId: OTHER_AGENT_ID },
          },
          harness.principal,
        ),
      ).rejects.toMatchObject({
        response: { code: 'agent_scope_denied' },
      });
      const own = await harness.service.propose(
        harness.ctx,
        {
          intent: 'pause_agent',
          requestText: 'pausa você',
          agentId: AGENT_ID,
          payload: { targetAgentId: AGENT_ID },
        },
        harness.principal,
      );
      expect(own.agentId).toBe(AGENT_ID);
      expect(own.canConfirm).toBe(true);
    });

    it('agent scope: CRM moves need the preset action and the agent pipeline', async () => {
      const harness = createHarness();
      const move = (agentId: string, pipelineId: string) =>
        harness.service.propose(
          harness.ctx,
          {
            intent: 'move_opportunity',
            requestText: 'move para proposta',
            agentId,
            payload: {
              opportunityId: OPPORTUNITY_ID,
              stageId: STAGE_ID,
              pipelineId,
            },
          },
          harness.principal,
        );
      // Ana captures leads but does not move cards.
      await expect(move(AGENT_ID, PIPELINE_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      // Bia moves cards, only in her pipeline.
      await expect(
        move(OTHER_AGENT_ID, '00000000-0000-4000-8000-0000000000f9'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      const allowed = await move(OTHER_AGENT_ID, PIPELINE_ID);
      expect(allowed.targetType).toBe('opportunity');
    });

    it('an agent from another context cannot receive a proposal', async () => {
      const harness = createHarness();
      await expect(
        harness.service.propose(
          harness.ctx,
          {
            intent: 'capacity_released',
            requestText: 'liberou',
            agentId: '00000000-0000-4000-8000-0000000000ee',
            payload: {},
          },
          harness.principal,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a proposal made to an agent that disappeared never widens to the user scope', async () => {
      const harness = createHarness();
      const proposed = await harness.service.propose(
        harness.ctx,
        {
          intent: 'activate_agent',
          requestText: 'volta',
          agentId: AGENT_ID,
          payload: { targetAgentId: AGENT_ID },
        },
        harness.principal,
      );
      harness.actions[0].agentId = null; // FK ON DELETE SET NULL
      await expect(
        harness.service.confirm(
          harness.ctx,
          proposed.id,
          { expectedRevision: proposed.revision },
          harness.principal,
        ),
      ).rejects.toMatchObject({ response: { code: 'agent_scope_denied' } });
      expect(harness.executor.execute).not.toHaveBeenCalled();
    });

    it('contact updates are limited to the allowlisted fields', async () => {
      const harness = createHarness();
      const proposed = await harness.service.propose(
        harness.ctx,
        {
          intent: 'update_contact_fields',
          requestText: 'muda o dono do contato',
          payload: {
            contactId: '00000000-0000-4000-8000-0000000000c9',
            fields: { ownerUserId: harness.ctx.userId, jobTitle: 'CEO' },
          },
        },
        harness.principal,
      );
      expect(proposed.canConfirm).toBe(false);
      expect(proposed.validationIssues).toContain(
        'Pelo chat só é possível alterar nome, sobrenome, nome de exibição e cargo.',
      );
    });
  });
});
