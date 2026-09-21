import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IsNull } from 'typeorm';
import { InboxRuntimeConfigService } from '../runtime/inbox-runtime-config.service';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { resolveInboxCompanyScope } from '../inbox-company-scope';
import { InboxAutonomyControlEntity } from '../entities/inbox-autonomy-control.entity';

@Injectable()
export class InboxAutonomyAdminService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly config: InboxRuntimeConfigService,
  ) {}

  async inspect(ctx: RequestContext) {
    const scope = resolveInboxCompanyScope(ctx);
    const { tenantId, workspaceId, agencyClientId, companyContextId, scopeKind } =
      scope;
    const [controlRows, actions, decisions, queues, providers, meta, created] =
      await Promise.all([
        this.dataSource.query<
          Array<{
            reply_enabled: boolean;
            crm_enabled: boolean;
            handoff_enabled: boolean;
            paused_at: Date | null;
            reason_code: string | null;
          }>
        >(
          `SELECT reply_enabled,crm_enabled,handoff_enabled,paused_at,reason_code
             FROM inbox_autonomy_controls
            WHERE tenant_id=$1 AND workspace_id=$2
              AND scope_kind=$3
              AND agency_client_id IS NOT DISTINCT FROM $4::uuid
              AND company_context_id IS NOT DISTINCT FROM $5::uuid`,
          [tenantId, workspaceId, scopeKind, agencyClientId, companyContextId],
        ),
        this.dataSource.query<
          Array<{
            outcome: string;
            status: string;
            reason_code: string;
            count: number;
          }>
        >(
          `SELECT action.policy_outcome outcome,action.status,action.reason_code,count(*)::int count
             FROM inbox_governed_actions action
             JOIN inbox_conversations conversation
               ON conversation.id = action.conversation_id
              AND conversation.tenant_id = action.tenant_id
              AND conversation.workspace_id = action.workspace_id
            WHERE action.tenant_id=$1 AND action.workspace_id=$2
              AND conversation.scope_kind=$3
              AND conversation.agency_client_id IS NOT DISTINCT FROM $4::uuid
              AND conversation.company_context_id IS NOT DISTINCT FROM $5::uuid
            GROUP BY action.policy_outcome,action.status,action.reason_code
            ORDER BY action.policy_outcome,action.status,action.reason_code`,
          [tenantId, workspaceId, scopeKind, agencyClientId, companyContextId],
        ),
        this.dataSource.query<Array<{ status: string; count: number }>>(
          `SELECT decision.status,count(*)::int count FROM inbox_agent_decisions decision
             JOIN inbox_conversations conversation
               ON conversation.id = decision.conversation_id
              AND conversation.tenant_id = decision.tenant_id
              AND conversation.workspace_id = decision.workspace_id
            WHERE decision.tenant_id=$1 AND decision.workspace_id=$2
              AND conversation.scope_kind=$3
              AND conversation.agency_client_id IS NOT DISTINCT FROM $4::uuid
              AND conversation.company_context_id IS NOT DISTINCT FROM $5::uuid
            GROUP BY decision.status ORDER BY decision.status`,
          [tenantId, workspaceId, scopeKind, agencyClientId, companyContextId],
        ),
        this.dataSource.query<
          Array<{ queue: string; status: string; count: number }>
        >(
          `SELECT 'batch' queue,batch.status,count(*)::int count
             FROM inbox_processing_batches batch
             JOIN inbox_conversations conversation
               ON conversation.id = batch.conversation_id
              AND conversation.tenant_id = batch.tenant_id
              AND conversation.workspace_id = batch.workspace_id
            WHERE batch.tenant_id=$1 AND batch.workspace_id=$2
              AND conversation.scope_kind=$3
              AND conversation.agency_client_id IS NOT DISTINCT FROM $4::uuid
              AND conversation.company_context_id IS NOT DISTINCT FROM $5::uuid
            GROUP BY batch.status
           UNION ALL
           SELECT 'media',media.status,count(*)::int count
             FROM inbox_media_assets media
             JOIN inbox_conversations conversation
               ON conversation.id = media.conversation_id
              AND conversation.tenant_id = media.tenant_id
              AND conversation.workspace_id = media.workspace_id
            WHERE media.tenant_id=$1 AND media.workspace_id=$2
              AND conversation.scope_kind=$3
              AND conversation.agency_client_id IS NOT DISTINCT FROM $4::uuid
              AND conversation.company_context_id IS NOT DISTINCT FROM $5::uuid
            GROUP BY media.status`,
          [tenantId, workspaceId, scopeKind, agencyClientId, companyContextId],
        ),
        // Provider usage has no durable conversation/channel parent yet.
        // Do not reinterpret a workspace aggregate as company-owned data.
        scopeKind === 'agency'
          ? this.dataSource.query<
              Array<{
                operation: string;
                status: string;
                count: number;
                estimated_cost_usd: string;
                average_latency_ms: number | null;
              }>
            >(
              `SELECT operation,status,count(*)::int count,
                      COALESCE(sum(estimated_cost_usd),0)::text estimated_cost_usd,
                      round(avg(latency_ms))::int average_latency_ms
                 FROM inbox_provider_usage_ledger
                WHERE tenant_id=$1 AND workspace_id=$2
                  AND created_at >= date_trunc('day',now())
                GROUP BY operation,status ORDER BY operation,status`,
              [tenantId, workspaceId],
            )
          : Promise.resolve([]),
        this.dataSource.query<
          Array<{
            operation: string;
            state: string;
            delivery_status: string | null;
            count: number;
            average_latency_ms: number | null;
          }>
        >(
          `SELECT operation.operation,operation.state,operation.delivery_status,count(*)::int count,
                  round(avg(operation.latency_ms))::int average_latency_ms
             FROM inbox_meta_operations operation
             JOIN inbox_conversations conversation
               ON conversation.id = operation.conversation_id
              AND conversation.tenant_id = operation.tenant_id
              AND conversation.workspace_id = operation.workspace_id
            WHERE operation.tenant_id=$1 AND operation.workspace_id=$2
              AND conversation.scope_kind=$3
              AND conversation.agency_client_id IS NOT DISTINCT FROM $4::uuid
              AND conversation.company_context_id IS NOT DISTINCT FROM $5::uuid
            GROUP BY operation.operation,operation.state,operation.delivery_status
            ORDER BY operation.operation,operation.state,operation.delivery_status`,
          [tenantId, workspaceId, scopeKind, agencyClientId, companyContextId],
        ),
        // Contacts are shared identities and CRM is outside this slice.
        scopeKind === 'agency'
          ? this.dataSource.query<Array<{ entity_type: string; count: number }>>(
              `SELECT 'contact' entity_type,count(*)::int count
                 FROM contacts WHERE tenant_id=$1 AND workspace_id=$2
                  AND source='leadflow_whatsapp'
               UNION ALL
               SELECT 'opportunity',count(*)::int count
                 FROM crm_opportunities WHERE tenant_id=$1 AND workspace_id=$2
                  AND source='leadflow' AND deleted_at IS NULL`,
              [tenantId, workspaceId],
            )
          : Promise.resolve([]),
      ]);
    const control = controlRows[0];
    return {
      flags: {
        pilotMode: this.config.pilotMode,
        ingestion: this.config.ingestionWorkerEnabled,
        media: this.config.mediaWorkerEnabled,
        decision: this.config.decisionWorkerEnabled,
        outbox: this.config.outboxRelayEnabled,
        realtime: this.config.realtimeGatewayEnabled,
        triggerMode: this.config.decisionTriggerMode,
        concurrency: this.config.decisionWorkerConcurrency,
        reply: this.config.autoReplyEnabled && (control?.reply_enabled ?? true),
        crm: this.config.autoCrmEnabled && (control?.crm_enabled ?? true),
        handoff:
          this.config.autoHandoffEnabled && (control?.handoff_enabled ?? true),
        followUp: false,
      },
      control: {
        pausedAt: control?.paused_at ?? null,
        reasonCode: control?.reason_code ?? null,
      },
      actions,
      decisions,
      queues,
      providers,
      meta,
      created,
    };
  }

  async setEffects(ctx: RequestContext, enabled: boolean) {
    const scope = resolveInboxCompanyScope(ctx);
    const { tenantId, workspaceId, agencyClientId, companyContextId, scopeKind } =
      scope;
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(InboxAutonomyControlEntity);
      const existing = await repository.findOne({
        where: {
          tenantId,
          workspaceId,
          agencyClientId: agencyClientId ?? IsNull(),
          companyContextId: companyContextId ?? IsNull(),
          scopeKind,
        },
      });
      await repository.save(
        repository.create({
          ...(existing ?? {}),
          tenantId,
          workspaceId,
          agencyClientId,
          companyContextId,
          scopeKind,
          replyEnabled: enabled,
          crmEnabled: enabled,
          handoffEnabled: enabled,
          pausedAt: enabled ? null : new Date(),
          pausedBy: ctx.userId ?? null,
          reasonCode: enabled ? null : 'operator_kill_switch',
        }),
      );
      await manager.query(
        `INSERT INTO platform_permission_audit_events
          (tenant_id,workspace_id,actor_user_id,action,resource_type,
           resource_id,risk_level,metadata)
         VALUES ($1,$2,$3,$4,'inbox_autonomy',$2,$5,$6::jsonb)`,
        [
          tenantId,
          workspaceId,
          ctx.userId ?? null,
          enabled ? 'inbox.autonomy.resumed' : 'inbox.autonomy.paused',
          enabled ? 'high' : 'critical',
          JSON.stringify({
            effectsEnabled: enabled,
            agencyClientId,
            companyContextId,
          }),
        ],
      );
      return { effectsEnabled: enabled };
    });
  }
}
