import { randomUUID } from 'node:crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Table, type DataSource, type QueryRunner } from 'typeorm';
import { AgencyDataSource } from '../../database/agency-typeorm.datasource';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import type { RequestContext } from '../../common/context/request-context.interface';
import {
  AgencyUserProfileEntity,
  AgencyWorkspaceUserEntity,
} from '../agency/entities/agency-settings.entities';
import { InboxConversationEntity } from '../inbox/entities/inbox-conversation.entity';
import { LeadFlowClientSettingsEntity } from '../leadflow-settings/entities';
import { LeadFlowBusinessMode } from '../leadflow-settings/enums/leadflow-business-mode.enum';
import { LeadFlowSettingsContextType } from '../leadflow-settings/enums/leadflow-settings-context-type.enum';
import {
  LeadFlowAgentChannelBindingEntity,
  LeadFlowAgentEntity,
  LeadFlowAgentOperationalStateEntity,
  LeadFlowAgentVersionEntity,
  LeadFlowOperationsActionEntity,
  LeadFlowOperationsActionEventEntity,
  OperationsRoomOutboxEntity,
  OperationsRoomRevisionEntity,
} from '../leadflow-agents/entities';
import { LeadFlowAgentsController } from '../leadflow-agents/leadflow-agents.controller';
import { LeadFlowAgentBindingReconcilerService } from '../leadflow-agents/services/leadflow-agent-binding-reconciler.service';
import { LeadFlowAgentPresetService } from '../leadflow-agents/services/leadflow-agent-preset.service';
import { LeadFlowAgentService } from '../leadflow-agents/services/leadflow-agent.service';
import { LeadFlowOperationsActionService } from '../leadflow-agents/services/leadflow-operations-action.service';
import { LeadFlowOperationsActionAccessService } from '../leadflow-agents/services/leadflow-operations-action-access.service';
import { LeadFlowOperationsActionExecutorService } from '../leadflow-agents/services/leadflow-operations-action-executor.service';
import { LeadFlowAgentPauseResumeService } from '../leadflow-agents/services/leadflow-agent-pause-resume.service';
import type { ClientAreaAccessLevel } from '../client-area/client-area.types';
import { OperationsRoomStateService } from '../leadflow-agents/services/operations-room-state.service';
import { LEADFLOW_CLIENT_SCOPE_SQL } from './leadflow-client-area-scope.service';

/**
 * OR3 — Operations Room security matrix on real PostgreSQL. Company A and Company B belong to
 * the same AgencyClient (the hardest sibling case). The level rule (`client_member` without
 * `manager` never proposes/confirms) is enforced by the bridge grant before any service runs and
 * is covered in `leadflow-client-area.http.spec.ts`; this matrix proves the data boundary.
 */
describePostgresIntegration()(
  'OR3 Operations Room company isolation (PostgreSQL)',
  () => {
    let runner: QueryRunner, schema: string;
    let controller: LeadFlowAgentsController;
    const tenantId = randomUUID(),
      workspaceId = randomUUID(),
      clientId = randomUUID(),
      userId = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    const agents = { a: randomUUID(), b: randomUUID(), agency: randomUUID() };
    const settings = { a: randomUUID(), b: randomUUID(), agency: randomUUID() };
    const company = (companyContextId: string): RequestContext => ({
      tenantId,
      workspaceId,
      userId,
      role: 'client_area_actor',
      managedContext: {
        productKey: 'leadflow',
        operatingMode: 'client',
        clientId,
        companyContextId,
        managedTenantId: null,
      },
    });
    const agency: RequestContext = { tenantId, workspaceId, userId };
    // The authenticated request the controller derives the principal from.
    const request = (
      ctx: RequestContext,
      level: ClientAreaAccessLevel | null = 'manager',
    ) =>
      (ctx.managedContext
        ? {
            user: { surface: 'client_area', sub: userId, tenantId },
            clientAreaContext: {
              surface: 'client_area',
              userId,
              tenantId,
              workspaceId,
              agencyClientId: clientId,
              companyContextId: ctx.managedContext.companyContextId,
              memberAccess: {
                leadflow_agents: { available: level !== null, level },
              },
            },
          }
        : {
            user: { sub: userId, tenantId, workspaceId, role: 'owner' },
          }) as never;
    let resumeJob: LeadFlowAgentPauseResumeService;
    const notifications = { process: jest.fn().mockResolvedValue(undefined) };
    const proposal = {
      intent: 'capacity_released' as const,
      requestText: 'Liberou uma mesa sexta às 15h',
      payload: {
        timezone: 'America/Sao_Paulo',
        resourceRef: 'table_slot',
        effectivePeriod: {
          startsAt: '2026-11-06T18:00:00.000Z',
          endsAt: '2026-11-06T19:00:00.000Z',
        },
      },
    };
    beforeAll(async () => {
      if (
        AgencyDataSource.options.type !== 'postgres' ||
        AgencyDataSource.options.database !== 'lyra_agency_test'
      )
        throw new Error('OR3 requires lyra_agency_test');
      if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    });
    afterAll(async () => {
      await AgencyDataSource.destroy();
    });
    beforeEach(async () => {
      runner = AgencyDataSource.createQueryRunner();
      await runner.connect();
      schema = `or3_room_${randomUUID().replaceAll('-', '')}`;
      await runner.query(`CREATE SCHEMA "${schema}"`);
      await runner.query(`SET search_path TO "${schema}",public`);
      for (const entity of [
        LeadFlowClientSettingsEntity,
        LeadFlowAgentEntity,
        LeadFlowAgentVersionEntity,
        LeadFlowAgentChannelBindingEntity,
        LeadFlowAgentOperationalStateEntity,
        LeadFlowOperationsActionEntity,
        LeadFlowOperationsActionEventEntity,
        OperationsRoomOutboxEntity,
        OperationsRoomRevisionEntity,
      ])
        await runner.createTable(
          Table.create(
            AgencyDataSource.getMetadata(entity),
            AgencyDataSource.driver,
          ),
          false,
          false,
          false,
        );
      const repo = runner.manager.getRepository(LeadFlowClientSettingsEntity);
      for (const [id, companyContextId] of [
        [settings.a, a],
        [settings.b, b],
      ] as const)
        await repo.save({
          id,
          tenantId,
          workspaceId,
          contextType: LeadFlowSettingsContextType.Client,
          agencyClientId: clientId,
          companyContextId,
          businessModeKey: LeadFlowBusinessMode.AgencyServices,
        });
      await repo.save({
        id: settings.agency,
        tenantId,
        workspaceId,
        contextType: LeadFlowSettingsContextType.Agency,
        businessModeKey: LeadFlowBusinessMode.AgencyServices,
      });
      for (const [agentId, settingsId, contextType, client, companyId] of [
        [agents.a, settings.a, 'client', clientId, a],
        [agents.b, settings.b, 'client', clientId, b],
        [agents.agency, settings.agency, 'agency', null, null],
      ] as const)
        await runner.query(
          `INSERT INTO leadflow_agents
            (id,tenant_id,workspace_id,settings_id,context_type,agency_client_id,company_context_id,
             business_mode_key,type,name,status,is_system,is_custom,is_protected,behavior_config,
             prompt_config,handoff_policy,crm_policy,channel_policy,avatar_config,readiness,metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'agency_services','custom','Agent','active',false,true,false,
                   '{}','{}','{}','{}','{}','{}','{}','{}')`,
          [
            agentId,
            tenantId,
            workspaceId,
            settingsId,
            contextType,
            client,
            companyId,
          ],
        );
      let version = 0;
      for (const agentId of [agents.a, agents.b, agents.agency])
        await runner.manager.getRepository(OperationsRoomOutboxEntity).save({
          eventId: randomUUID(),
          tenantId,
          workspaceId,
          roomVersion: String(++version),
          agentId,
          agentRevision: '1',
          eventType: 'agent.status.changed',
          occurredAt: new Date(),
          source: 'agent_runtime',
          payload: {
            agentId,
            status: 'available',
            statusSince: new Date().toISOString(),
            source: 'agent_runtime',
          },
          nextAttemptAt: new Date(),
        } as never);
      await runner.manager
        .getRepository(OperationsRoomRevisionEntity)
        .save({ tenantId, workspaceId, roomVersion: String(version) } as never);
      // Every repository and transaction stays on this isolated schema's query runner.
      const scoped = {
        manager: runner.manager,
        query: (sql: string, params?: unknown[]) => runner.query(sql, params),
        getRepository: <T>(entity: new () => T) =>
          runner.manager.getRepository(entity),
        transaction: <T>(fn: (manager: typeof runner.manager) => Promise<T>) =>
          runner.manager.transaction(fn),
      } as unknown as DataSource;
      const agentService = new LeadFlowAgentService(
        runner.manager.getRepository(LeadFlowAgentEntity),
        runner.manager.getRepository(LeadFlowAgentVersionEntity),
        runner.manager.getRepository(LeadFlowAgentChannelBindingEntity),
        runner.manager.getRepository(LeadFlowClientSettingsEntity),
        runner.manager.getRepository(InboxConversationEntity),
        runner.manager.getRepository(AgencyWorkspaceUserEntity),
        runner.manager.getRepository(AgencyUserProfileEntity),
        new LeadFlowAgentPresetService(),
        { buildAgentContract: () => ({}) } as never,
        {} as never,
        new LeadFlowAgentBindingReconcilerService(scoped),
        { recordTransition: () => Promise.resolve(undefined) } as never,
      );
      controller = new LeadFlowAgentsController(
        agentService,
        new OperationsRoomStateService(
          scoped,
          runner.manager.getRepository(LeadFlowAgentOperationalStateEntity),
          runner.manager.getRepository(OperationsRoomOutboxEntity),
        ),
        new LeadFlowOperationsActionService(
          scoped,
          runner.manager.getRepository(LeadFlowClientSettingsEntity),
          runner.manager.getRepository(LeadFlowOperationsActionEntity),
          agentService,
          // Real level projection; the bridge scope resolver is proven by the
          // `room-action` SQL below and by the CA11 suites.
          new LeadFlowOperationsActionAccessService(
            { assertAny: () => Promise.resolve() } as never,
            { assertClientAreaScope: () => Promise.resolve() } as never,
          ),
          new LeadFlowOperationsActionExecutorService(
            agentService,
            {} as never,
            {} as never,
            {} as never,
          ),
        ),
      );
      resumeJob = new LeadFlowAgentPauseResumeService(
        scoped,
        runner.manager.getRepository(LeadFlowAgentEntity),
        agentService,
        notifications as never,
      );
    });
    afterEach(async () => {
      await runner.query('SET search_path TO public');
      await runner.query(`DROP SCHEMA "${schema}" CASCADE`);
      await runner.release();
    });

    it('room state and replay only carry the principal company agents', async () => {
      const ids = async (ctx: RequestContext) =>
        (await controller.roomState(ctx)).agents.map((row) => row.agentId);
      expect(await ids(company(a))).toEqual([agents.a]);
      expect(await ids(company(b))).toEqual([agents.b]);
      expect(await ids(agency)).toEqual([agents.agency]);
      const replay = await controller.roomEvents(company(a), '0', '100');
      expect(replay.events.map((event) => event.payload.agentId)).toEqual([
        agents.a,
      ]);
      expect(replay.events[0]).toMatchObject({
        scopeKind: 'company',
        agencyClientId: clientId,
        companyContextId: a,
      });
      const agencyReplay = await controller.roomEvents(agency, '0', '100');
      expect(agencyReplay.events.map((e) => e.payload.agentId)).toEqual([
        agents.agency,
      ]);
    });

    it('a sibling company never lists, confirms or cancels another company proposal', async () => {
      const own = await controller.proposeRoomAction(
        company(a),
        request(company(a)),
        proposal,
      );
      expect(
        (await controller.listRoomActions(company(a))).items.map((i) => i.id),
      ).toEqual([own.id]);
      expect((await controller.listRoomActions(company(b))).items).toEqual([]);
      expect((await controller.listRoomActions(agency)).items).toEqual([]);
      for (const ctx of [company(b), agency]) {
        await expect(
          controller.confirmRoomAction(ctx, request(ctx), own.id, {
            expectedRevision: own.revision,
          }),
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(
          controller.cancelRoomAction(ctx, own.id, {
            expectedRevision: own.revision,
          }),
        ).rejects.toBeInstanceOf(NotFoundException);
      }
      // The bridge proves the proposal's company before the controller runs.
      const scope = (companyContextId: string) =>
        runner.query(LEADFLOW_CLIENT_SCOPE_SQL['room-action']!, [
          tenantId,
          workspaceId,
          clientId,
          companyContextId,
          own.id,
        ]);
      expect(await scope(a)).toEqual([
        { id: own.id, client: clientId, company: a, creator: userId },
      ]);
      expect(await scope(b)).toEqual([]);
      const confirmed = await controller.confirmRoomAction(
        company(a),
        request(company(a)),
        own.id,
        { expectedRevision: own.revision },
      );
      expect(confirmed.status).toBe('confirmed');
    });

    it('keeps the Agency room proposals in the Agency settings row', async () => {
      const own = await controller.proposeRoomAction(
        agency,
        request(agency),
        proposal,
      );
      expect(
        (await controller.listRoomActions(agency)).items.map((i) => i.id),
      ).toEqual([own.id]);
      expect((await controller.listRoomActions(company(a))).items).toEqual([]);
      const row: unknown = await runner.query(
        'SELECT settings_id FROM leadflow_operations_actions WHERE id=$1',
        [own.id],
      );
      expect(row).toEqual([{ settings_id: settings.agency }]);
    });

    describe('OR5 — timed pause, confirmer permission and agent scope', () => {
      const pause = (
        targetAgentId: string,
        endsAt: string | null,
        agentId?: string,
      ) => ({
        intent: 'pause_agent' as const,
        requestText: 'pausa até segunda',
        agentId,
        payload: {
          targetAgentId,
          timezone: 'America/Sao_Paulo',
          effectivePeriod: { endsAt },
        },
      });
      const agentRow = async (id: string) =>
        (
          (await runner.query(
            'SELECT status, paused_until FROM leadflow_agents WHERE id=$1',
            [id],
          )) as Array<{ status: string; paused_until: Date | null }>
        )[0];

      it('a company never targets a sibling company agent, as target or as agent', async () => {
        const until = new Date(Date.now() + 2 * 86_400_000).toISOString();
        await expect(
          controller.proposeRoomAction(
            company(a),
            request(company(a)),
            pause(agents.b, until),
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(
          controller.proposeRoomAction(
            company(a),
            request(company(a)),
            pause(agents.a, until, agents.b),
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
        // An agent only pauses itself.
        await expect(
          controller.proposeRoomAction(
            agency,
            request(agency),
            pause(agents.a, until, agents.agency),
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(
          await runner.query(
            'SELECT count(*)::int AS n FROM leadflow_operations_actions',
          ),
        ).toEqual([{ n: 0 }]);
      });

      it('the confirmer level decides: operator is refused, manager pauses until the date', async () => {
        const until = new Date(Date.now() + 2 * 86_400_000);
        const own = await controller.proposeRoomAction(
          company(a),
          request(company(a)),
          pause(agents.a, until.toISOString(), agents.a),
        );
        expect(own).toMatchObject({ agentId: agents.a, canConfirm: true });
        await expect(
          controller.confirmRoomAction(
            company(a),
            request(company(a), 'operator'),
            own.id,
            { expectedRevision: own.revision },
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(await agentRow(agents.a)).toMatchObject({
          status: 'active',
          paused_until: null,
        });
        const confirmed = await controller.confirmRoomAction(
          company(a),
          request(company(a)),
          own.id,
          { expectedRevision: own.revision },
        );
        expect(confirmed.status).toBe('confirmed');
        const row = await agentRow(agents.a);
        expect(row.status).toBe('paused');
        expect(row.paused_until?.toISOString()).toBe(until.toISOString());
        // The sibling company agent is untouched.
        expect((await agentRow(agents.b)).status).toBe('active');
      });

      it('the resume job reactivates only due agents, once', async () => {
        const due = new Date(Date.now() - 60_000);
        const later = new Date(Date.now() + 86_400_000);
        await runner.query(
          `UPDATE leadflow_agents SET status='paused', paused_until=$2, updated_by_id=$3 WHERE id=$1`,
          [agents.a, due, userId],
        );
        await runner.query(
          `UPDATE leadflow_agents SET status='paused', paused_until=$2 WHERE id=$1`,
          [agents.b, later],
        );
        expect(await resumeJob.resumeDue()).toBe(1);
        expect(await agentRow(agents.a)).toMatchObject({
          status: 'active',
          paused_until: null,
        });
        expect((await agentRow(agents.b)).status).toBe('paused');
        expect(notifications.process).toHaveBeenCalledWith(
          expect.objectContaining({
            eventType: 'leadflow.agent.pause_ended',
            recipients: [expect.objectContaining({ userId })],
          }),
        );
        expect(await resumeJob.resumeDue()).toBe(0);
      });
    });
  },
);
