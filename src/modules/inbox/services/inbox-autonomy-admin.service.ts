import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InboxRuntimeConfigService } from '../runtime/inbox-runtime-config.service';

@Injectable()
export class InboxAutonomyAdminService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly config: InboxRuntimeConfigService,
  ) {}

  async inspect(tenantId: string, workspaceId: string) {
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
            WHERE tenant_id=$1 AND workspace_id=$2`,
          [tenantId, workspaceId],
        ),
        this.dataSource.query<
          Array<{
            outcome: string;
            status: string;
            reason_code: string;
            count: number;
          }>
        >(
          `SELECT policy_outcome outcome,status,reason_code,count(*)::int count
             FROM inbox_governed_actions
            WHERE tenant_id=$1 AND workspace_id=$2
            GROUP BY policy_outcome,status,reason_code
            ORDER BY policy_outcome,status,reason_code`,
          [tenantId, workspaceId],
        ),
        this.dataSource.query<Array<{ status: string; count: number }>>(
          `SELECT status,count(*)::int count FROM inbox_agent_decisions
            WHERE tenant_id=$1 AND workspace_id=$2 GROUP BY status ORDER BY status`,
          [tenantId, workspaceId],
        ),
        this.dataSource.query<
          Array<{ queue: string; status: string; count: number }>
        >(
          `SELECT 'batch' queue,status,count(*)::int count
             FROM inbox_processing_batches WHERE tenant_id=$1 AND workspace_id=$2
            GROUP BY status
           UNION ALL
           SELECT 'outbox',status,count(*)::int count
             FROM inbox_domain_outbox WHERE tenant_id=$1 AND workspace_id=$2
            GROUP BY status
           UNION ALL
           SELECT 'media',status,count(*)::int count
             FROM inbox_media_assets WHERE tenant_id=$1 AND workspace_id=$2
            GROUP BY status`,
          [tenantId, workspaceId],
        ),
        this.dataSource.query<
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
        ),
        this.dataSource.query<
          Array<{
            operation: string;
            state: string;
            delivery_status: string | null;
            count: number;
            average_latency_ms: number | null;
          }>
        >(
          `SELECT operation,state,delivery_status,count(*)::int count,
                  round(avg(latency_ms))::int average_latency_ms
             FROM inbox_meta_operations
            WHERE tenant_id=$1 AND workspace_id=$2
            GROUP BY operation,state,delivery_status
            ORDER BY operation,state,delivery_status`,
          [tenantId, workspaceId],
        ),
        this.dataSource.query<Array<{ entity_type: string; count: number }>>(
          `SELECT 'contact' entity_type,count(*)::int count
             FROM contacts WHERE tenant_id=$1 AND workspace_id=$2
              AND source='leadflow_whatsapp'
           UNION ALL
           SELECT 'opportunity',count(*)::int count
             FROM crm_opportunities WHERE tenant_id=$1 AND workspace_id=$2
              AND source='leadflow' AND deleted_at IS NULL`,
          [tenantId, workspaceId],
        ),
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

  async setEffects(
    tenantId: string,
    workspaceId: string,
    enabled: boolean,
    actorUserId?: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO inbox_autonomy_controls
          (tenant_id,workspace_id,reply_enabled,crm_enabled,handoff_enabled,
           paused_at,paused_by,reason_code)
         VALUES ($1,$2,$3,$3,$3,$4,$5,$6)
         ON CONFLICT (tenant_id,workspace_id) DO UPDATE SET
           reply_enabled=EXCLUDED.reply_enabled,
           crm_enabled=EXCLUDED.crm_enabled,
           handoff_enabled=EXCLUDED.handoff_enabled,
           paused_at=EXCLUDED.paused_at,
           paused_by=EXCLUDED.paused_by,
           reason_code=EXCLUDED.reason_code,
           updated_at=now()`,
        [
          tenantId,
          workspaceId,
          enabled,
          enabled ? null : new Date(),
          actorUserId ?? null,
          enabled ? null : 'operator_kill_switch',
        ],
      );
      await manager.query(
        `INSERT INTO platform_permission_audit_events
          (tenant_id,workspace_id,actor_user_id,action,resource_type,
           resource_id,risk_level,metadata)
         VALUES ($1,$2,$3,$4,'inbox_autonomy',$2,$5,$6::jsonb)`,
        [
          tenantId,
          workspaceId,
          actorUserId ?? null,
          enabled ? 'inbox.autonomy.resumed' : 'inbox.autonomy.paused',
          enabled ? 'high' : 'critical',
          JSON.stringify({ effectsEnabled: enabled }),
        ],
      );
      return { effectsEnabled: enabled };
    });
  }
}
