import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ClientAreaBridgeRegistry } from '../../common/client-area-bridge/client-area-bridge.registry';
import {
  isUuid,
  type ClientAreaContext,
  type ClientAreaModuleKey,
} from '../client-area/client-area.types';
import type { PermissionScopeRequest } from '../permissions/types/permission-context.types';
import {
  leadFlowClientAreaRoute,
  type LeadFlowClientKind,
} from './leadflow-client-area.routes';

type Row = {
  id: string;
  client: string;
  company: string;
  creator: string | null;
  parent?: string | null;
  channel?: string | null;
  external?: string | null;
  handoff?: unknown;
};
const direct = (table: string, creator = 'NULL', extra = '') =>
  `SELECT id,agency_client_id AS client,company_context_id AS company,${creator} AS creator ${extra} FROM ${table} WHERE tenant_id=$1 AND workspace_id=$2 AND agency_client_id=$3 AND company_context_id=$4 AND id=$5`;
export const LEADFLOW_CLIENT_SCOPE_SQL: Partial<
  Record<LeadFlowClientKind, string>
> = {
  channel:
    direct('inbox_channels', 'NULL', ',NULL AS parent') +
    " AND scope_kind='company' AND deleted_at IS NULL",
  conversation:
    direct(
      'inbox_conversations',
      'assigned_user_id',
      ',channel_id AS channel,external_thread_id AS external',
    ) + " AND scope_kind='company'",
  opportunity:
    direct(
      'crm_opportunities',
      'created_by_user_id',
      ',pipeline_id AS parent',
    ) + " AND scope_kind='company' AND deleted_at IS NULL",
  contact: `SELECT c.id,l.agency_client_id AS client,l.company_context_id AS company,c.created_by_user_id AS creator FROM contacts c JOIN leadflow_contact_companies l ON l.contact_id=c.id AND l.tenant_id=c.tenant_id AND l.workspace_id=c.workspace_id WHERE c.tenant_id=$1 AND c.workspace_id=$2 AND l.agency_client_id=$3 AND l.company_context_id=$4 AND c.id=$5 AND l.scope_kind='company'`,
  pipeline:
    direct('crm_pipelines') +
    " AND scope_kind='company' AND deleted_at IS NULL",
  tag: direct('crm_tags') + " AND scope_kind='company' AND deleted_at IS NULL",
  stage: `SELECT s.id,p.agency_client_id AS client,p.company_context_id AS company,NULL AS creator,s.pipeline_id AS parent FROM crm_stages s JOIN crm_pipelines p ON p.id=s.pipeline_id AND p.tenant_id=s.tenant_id AND p.workspace_id=s.workspace_id WHERE p.tenant_id=$1 AND p.workspace_id=$2 AND p.agency_client_id=$3 AND p.company_context_id=$4 AND s.id=$5 AND p.scope_kind='company' AND p.deleted_at IS NULL AND s.deleted_at IS NULL`,
  appointment:
    direct('scheduled_items', 'created_by_user_id') +
    " AND scope_kind='company' AND deleted_at IS NULL",
  agent:
    direct('leadflow_agents', 'created_by_id', ',handoff_policy AS handoff') +
    ' AND deleted_at IS NULL',
  'followup-template':
    direct('inbox_followup_templates') + " AND scope_kind='company'",
  media: `SELECT m.id,c.agency_client_id AS client,c.company_context_id AS company,c.assigned_user_id AS creator,c.id AS parent FROM inbox_media_assets m JOIN inbox_conversations c ON c.id=m.conversation_id AND c.tenant_id=m.tenant_id AND c.workspace_id=m.workspace_id WHERE c.tenant_id=$1 AND c.workspace_id=$2 AND c.agency_client_id=$3 AND c.company_context_id=$4 AND m.id=$5 AND c.scope_kind='company'`,
};
const relations: Record<string, LeadFlowClientKind> = {
  channelId: 'channel',
  contactId: 'contact',
  recipientContactId: 'contact',
  pipelineId: 'pipeline',
  targetPipelineId: 'pipeline',
  stageId: 'stage',
  targetStageId: 'stage',
  tagId: 'tag',
  assignedAgentId: 'agent',
  inboxConversationId: 'conversation',
  sourceConversationId: 'conversation',
  sourceOpportunityId: 'opportunity',
  beforeOpportunityId: 'opportunity',
  conversationId: 'conversation',
  companyContactId: 'contact',
  defaultAgentId: 'agent',
};
// References whose target table the bridge cannot prove company-bound are never accepted.
const unverifiable = ['sourceLeadId', 'senderAgentId'];
/**
 * Route policies (not field mirrors): the Agency DTO stays the write contract. A client note
 * carries no identity/provider fields (the token is the author) and the Inbox settings row is
 * agency configuration except its quick replies until CA14-B.
 */
const policyFields: Record<string, readonly string[]> = {
  'POST /inbox/conversations/:id/messages': [
    'content',
    'messageType',
    'direction',
  ],
  'PATCH /inbox/settings': ['quickReplies'],
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** CA11: only company resources enter the bridge; no product or workspace fallback. */
@Injectable()
export class LeadFlowClientAreaScopeService implements OnModuleInit {
  constructor(
    @InjectDataSource('agency') private readonly db: DataSource,
    private readonly registry: ClientAreaBridgeRegistry,
  ) {}
  onModuleInit() {
    for (const module of [
      'leadflow_inbox',
      'leadflow_crm',
      'leadflow_appointments',
      'leadflow_agents',
    ] as const)
      this.registry.registerScopeResolver(module, (context, key, request) =>
        this.resolve(module, context, key, request),
      );
  }
  async resolve(
    module: ClientAreaModuleKey,
    context: ClientAreaContext,
    _key: string,
    request: PermissionScopeRequest,
  ) {
    const route = leadFlowClientAreaRoute(
      request.method ?? '',
      request.routePath ?? '',
    );
    if (!route || route.module !== module) return null;
    if (request.body !== undefined && !object(request.body)) return null;
    const body = request.body ?? {},
      query = request.query ?? {},
      params = request.params ?? {};
    const write = !['GET', 'HEAD'].includes(request.method ?? '');
    const level = context.memberAccess?.[module]?.level;
    if (write && level === 'viewer') return null;
    const policy = policyFields[`${route.method} ${route.path}`];
    if (
      write &&
      policy &&
      Object.keys(body).some((field) => !policy.includes(field))
    )
      return null;
    if (unverifiable.some((field) => body[field] != null)) return null;
    if (route.path === '/inbox/channels/bindings/reconcile') {
      // Never the workspace-wide sweep: one company channel, one explicit agent or null.
      if (
        !isUuid(body.channelId) ||
        !('defaultAgentId' in body) ||
        (body.defaultAgentId !== null && !isUuid(body.defaultAgentId))
      )
        return null;
    }
    if (body.videoMode === 'native') return null; // native Team Meetings are not a client appointment transport
    if (route.kind === 'message' && route.path.endsWith('/messages') && write) {
      if (body.direction !== undefined && body.direction !== 'internal')
        return null;
      if (body.messageType !== undefined && body.messageType !== 'note')
        return null;
      body.direction = 'internal';
      body.messageType = 'note';
    }
    const scope = [
      context.tenantId,
      context.workspaceId,
      context.agencyClientId,
      context.companyContextId,
    ];
    const load = async (
      kind: LeadFlowClientKind,
      id: unknown,
    ): Promise<Row | null> => {
      if (!isUuid(id) || !LEADFLOW_CLIENT_SCOPE_SQL[kind]) return null;
      const rows = await this.db.query<Row[]>(LEADFLOW_CLIENT_SCOPE_SQL[kind], [
        ...scope,
        id,
      ]);
      const row = rows[0];
      return row &&
        row.client === context.agencyClientId &&
        row.company === context.companyContextId
        ? row
        : null;
    };
    // Custom catalog templates are tenant-wide; only the authenticated company's mode is addressable.
    if (route.kind === 'catalog' && query.businessMode !== undefined) {
      if (typeof query.businessMode !== 'string') return null;
      const modes = await this.db.query<{ mode: string }[]>(
        `SELECT business_mode_key AS mode FROM leadflow_client_settings WHERE tenant_id=$1 AND workspace_id=$2 AND agency_client_id=$3 AND company_context_id=$4 AND context_type='client'`,
        scope,
      );
      if (!modes[0] || modes[0].mode !== query.businessMode) return null;
    }
    let primary: Row | null = null;
    let kind = route.kind;
    let primaryId: unknown = params.contactId ?? params.mediaId ?? params.id;
    if (route.kind === 'message' || route.kind === 'outbound') {
      kind = 'conversation';
      primaryId = params.id ?? body.conversationId ?? query.conversationId;
      if (!primaryId) return null;
    }
    if (route.kind === 'participant' || route.kind === 'reminder')
      kind = 'appointment';
    if (primaryId) {
      primary = await load(kind, primaryId);
      if (!primary) return null;
    }
    // A child id can never be borrowed from another conversation/appointment.
    const child = async (
      table: string,
      parentColumn: string,
      id: unknown,
      parentId: unknown,
    ) => {
      if (!isUuid(id) || !isUuid(parentId)) return false;
      return (
        (
          await this.db.query<unknown[]>(
            `SELECT id FROM ${table} WHERE tenant_id=$1 AND workspace_id=$2 AND ${parentColumn}=$3 AND id=$4`,
            [context.tenantId, context.workspaceId, parentId, id],
          )
        ).length > 0
      );
    };
    if (
      params.messageId &&
      !(await child(
        'inbox_messages',
        'conversation_id',
        params.messageId,
        primaryId,
      ))
    )
      return null;
    if (
      body.replyToMessageId &&
      !(await child(
        'inbox_messages',
        'conversation_id',
        body.replyToMessageId,
        primaryId,
      ))
    )
      return null;
    if (
      params.participantId &&
      !(await child(
        'scheduled_item_participants',
        'scheduled_item_id',
        params.participantId,
        primaryId,
      ))
    )
      return null;
    if (
      params.reminderId &&
      !(await child(
        'scheduled_item_reminders',
        'scheduled_item_id',
        params.reminderId,
        primaryId,
      ))
    )
      return null;
    for (const data of [body, query])
      for (const [field, refKind] of Object.entries(relations)) {
        const value = data[field];
        if (value === undefined || value === null || value === '') continue;
        const related = await load(refKind, value);
        if (!related) return null;
        if (
          field === 'channelId' &&
          kind === 'conversation' &&
          primary?.channel &&
          primary.channel !== value &&
          route.kind === 'outbound'
        )
          return null;
        if (field === 'stageId' || field === 'targetStageId') {
          const pipeline =
            data.pipelineId ?? data.targetPipelineId ?? primary?.parent;
          if (pipeline && related.parent !== pipeline) return null;
        }
      }
    if (route.kind === 'outbound') {
      const intent = route.path.endsWith('send-media') ? query : body;
      if (
        !isUuid(intent.channelId) ||
        !isUuid(intent.conversationId) ||
        primary?.channel !== intent.channelId ||
        typeof intent.to !== 'string'
      )
        return null;
      if (intent.to !== undefined && intent.to !== primary?.external)
        return null;
    }
    // Authorship and assignment are distinct: Inbox operators act on their current assignment;
    // CRM/appointments use immutable creation identity (not the current owner).
    let creator = primary?.creator ?? context.userId;
    if (write && level === 'operator' && primary) {
      if (
        kind === 'conversation' &&
        route.path.endsWith('/assume') &&
        !primary.creator
      )
        creator = context.userId;
      else if (primary.creator !== context.userId) return null;
    }
    const member = async (id: unknown) => {
      if (id === context.userId) return true;
      if (!isUuid(id)) return false;
      return (
        (
          await this.db.query<unknown[]>(
            `SELECT id FROM client_area_memberships WHERE tenant_id=$1 AND workspace_id=$2 AND agency_client_id=$3 AND company_context_id=$4 AND user_id=$5 AND status='active'`,
            [...scope, id],
          )
        ).length > 0
      );
    };
    for (const field of [
      'assignedUserId',
      'ownerUserId',
      'userId',
      'recipientUserId',
    ]) {
      const value = body[field];
      if (
        value !== undefined &&
        value !== null &&
        (!(await member(value)) ||
          (kind === 'conversation' &&
            level === 'operator' &&
            value !== context.userId))
      )
        return null;
    }
    if (body.allowedUserIds !== undefined) {
      if (
        !Array.isArray(body.allowedUserIds) ||
        body.allowedUserIds.length > 200
      )
        return null;
      for (const id of body.allowedUserIds)
        if (!(await member(id))) return null;
    }
    for (const [field, refKind] of [
      ['opportunities', 'opportunity'],
      ['stages', 'stage'],
    ] as const) {
      if (body[field] === undefined) continue;
      if (!Array.isArray(body[field]) || body[field].length > 200) return null;
      for (const entry of body[field] as unknown[]) {
        if (
          !object(entry) ||
          Object.keys(entry).some(
            (k) =>
              ![
                'id',
                'stageId',
                'sortOrder',
                'expectedVersion',
                'reasonCode',
              ].includes(k),
          )
        )
          return null;
        const row = await load(refKind, entry.id);
        if (
          !row ||
          (refKind === 'opportunity' &&
            level === 'operator' &&
            row.creator !== context.userId)
        )
          return null;
        if (entry.stageId) {
          const stage = await load('stage', entry.stageId);
          if (!stage || stage.parent !== row.parent) return null;
        }
      }
    }
    // Nested policies keep the Agency shape; only their references are proved here.
    if (body.handoffPolicy !== undefined) {
      if (!object(body.handoffPolicy)) return null;
      // PATCH retains omitted values. Validate the effective pair, including a retained stage.
      const policy = {
        ...(object(primary?.handoff) ? primary.handoff : {}),
        ...body.handoffPolicy,
      };
      const pipeline = policy.targetPipelineId
        ? await load('pipeline', policy.targetPipelineId)
        : null;
      const stage = policy.targetStageId
        ? await load('stage', policy.targetStageId)
        : null;
      if (
        (policy.targetPipelineId && !pipeline) ||
        (policy.targetStageId &&
          (!stage || !pipeline || stage.parent !== pipeline.id))
      )
        return null;
      if (body.handoffPolicy.targetUserIds !== undefined) {
        if (!Array.isArray(body.handoffPolicy.targetUserIds)) return null;
        // Targets the agency already set are retained as-is; a new target must be a member.
        const retained = new Set(
          object(primary?.handoff) &&
            Array.isArray(primary.handoff.targetUserIds)
            ? (primary.handoff.targetUserIds as unknown[])
            : [],
        );
        for (const id of body.handoffPolicy.targetUserIds)
          if (!retained.has(id) && !(await member(id))) return null;
      }
    }
    if (body.crmPolicy !== undefined) {
      // Existing agent configuration accepts JSON; keep its relational references company-bound.
      if (!object(body.crmPolicy)) return null;
      if (
        body.crmPolicy.pipelineRef !== undefined &&
        body.crmPolicy.pipelineRef !== null
      ) {
        if (!object(body.crmPolicy.pipelineRef)) return null;
        const ref = body.crmPolicy.pipelineRef;
        const pipelineId = ref.pipelineId ?? ref.id;
        const pipeline = pipelineId ? await load('pipeline', pipelineId) : null;
        const stage = ref.stageId ? await load('stage', ref.stageId) : null;
        if (
          (pipelineId && !pipeline) ||
          (ref.stageId && (!stage || !pipeline || stage.parent !== pipeline.id))
        )
          return null;
      }
    }
    if (body.channelPolicy !== undefined) {
      if (!object(body.channelPolicy)) return null;
      if (
        body.channelPolicy.channelActivationPolicies !== undefined &&
        body.channelPolicy.channelActivationPolicies !== null
      ) {
        if (!object(body.channelPolicy.channelActivationPolicies)) return null;
        for (const id of Object.keys(
          body.channelPolicy.channelActivationPolicies,
        ))
          if (!(await load('channel', id))) return null;
      }
    }
    if (body.clientId !== undefined && body.clientId !== context.agencyClientId)
      return null;
    if (
      route.kind === 'conversation' &&
      route.method === 'POST' &&
      route.path === '/inbox/conversations' &&
      level === 'operator'
    )
      body.assignedUserId = context.userId;
    return {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      agencyClientId: context.agencyClientId,
      companyContextId: context.companyContextId,
      createdById: creator,
    };
  }
}
