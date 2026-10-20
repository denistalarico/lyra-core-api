import {
  Injectable,
  NotFoundException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { map } from 'rxjs';
import type { ClientAreaRequest } from '../client-area/client-area.types';
import {
  leadFlowClientAreaRoute,
  type LeadFlowClientKind,
  type LeadFlowClientRoute,
} from './leadflow-client-area.routes';

const pick = (value: unknown, fields: readonly string[]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  return Object.fromEntries(
    fields.filter((key) => key in row).map((key) => [key, row[key]]),
  );
};
// Expected JSON leaves may be primitives or arrays of strings, never arbitrary nested objects.
const pickLeaves = (value: unknown, names: readonly string[]) =>
  Object.fromEntries(
    Object.entries(pick(value, names)).filter(
      ([, entry]) =>
        entry === null ||
        ['string', 'number', 'boolean'].includes(typeof entry) ||
        (Array.isArray(entry) &&
          entry.every((item) => typeof item === 'string')),
    ),
  );
const common = [
  'id',
  'name',
  'description',
  'status',
  'createdAt',
  'updatedAt',
];
const fields: Record<LeadFlowClientKind, readonly string[]> = {
  channel: [
    ...common,
    'type',
    'provider',
    'connectionStatus',
    'displayPhoneNumber',
    'displayName',
    'username',
  ],
  conversation: [
    ...common,
    'channelId',
    'contactId',
    'opportunityId',
    'externalThreadId',
    'title',
    'priority',
    'assignedUserId',
    'assignedAgentId',
    'source',
    'businessMode',
    'lastMessagePreview',
    'lastMessageAt',
    'unreadCount',
    'aiEnabled',
    'ownershipState',
    'ownershipVersion',
  ],
  message: [
    'id',
    'conversationId',
    'direction',
    'senderType',
    'senderUserId',
    'senderUserName',
    'messageType',
    'content',
    'status',
    'sentAt',
    'deliveredAt',
    'readAt',
    'occurredAt',
    'createdAt',
  ],
  media: [],
  outbound: ['ok', 'conversationId', 'messageId'],
  settings: [],
  contact: [
    'id',
    'type',
    'displayName',
    'firstName',
    'lastName',
    'legalName',
    'documentType',
    'documentNumber',
    'jobTitle',
    'source',
    'businessMode',
    'lifecycleStage',
    'lifecycleStages',
    'status',
    'ownerUserId',
    'createdByUserId',
    'notes',
    'createdAt',
    'updatedAt',
    'avatarUrl',
    'email',
    'phone',
    'primaryEmail',
    'primaryPhone',
  ],
  'contact-list': ['id', 'name', 'description', 'color'],
  pipeline: [...common, 'businessMode', 'sortOrder', 'isDefault'],
  stage: [
    ...common,
    'pipelineId',
    'type',
    'color',
    'sortOrder',
    'probability',
    'isWonStage',
    'isLostStage',
    'isInitialStage',
    'isFolded',
    'operationMode',
    'role',
    'opportunityCount',
  ],
  tag: [...common, 'color'],
  opportunity: [
    'id',
    'pipelineId',
    'stageId',
    'contactId',
    'contactName',
    'contactEmail',
    'contactPhone',
    'inboxConversationId',
    'sourceOpportunityId',
    'title',
    'description',
    'valueAmount',
    'currency',
    'status',
    'priority',
    'source',
    'businessMode',
    'operationalStatus',
    'assignedUserId',
    'expectedCloseDate',
    'nextFollowUpAt',
    'lastActivityAt',
    'wonAt',
    'lostAt',
    'lostReason',
    'cardColor',
    'sortOrder',
    'visibility',
    'followMode',
    'autonomyMode',
    'rowVersion',
    'createdAt',
    'updatedAt',
  ],
  appointment: [
    'id',
    'type',
    'status',
    'priority',
    'title',
    'description',
    'notes',
    'startAt',
    'endAt',
    'dueAt',
    'allDay',
    'timezone',
    'locationType',
    'locationText',
    'videoMode',
    'videoUrl',
    'phoneUrl',
    'visibility',
    'ownerUserId',
    'assignedUserId',
    'createdByUserId',
    'contactId',
    'sourceChannel',
    'sourceConversationId',
    'sourceOpportunityId',
    'createdAt',
    'updatedAt',
  ],
  agenda: [
    'agendaItemId',
    'source',
    'sourceId',
    'kind',
    'title',
    'description',
    'startsAt',
    'endsAt',
    'dueAt',
    'timezone',
    'state',
    'ownerUserId',
    'contactId',
    'opportunityId',
    'createdAt',
    'updatedAt',
  ],
  participant: [
    'id',
    'scheduledItemId',
    'participantType',
    'userId',
    'contactId',
    'externalName',
    'externalEmail',
    'externalPhone',
    'responseStatus',
    'createdAt',
    'updatedAt',
  ],
  reminder: [
    'id',
    'scheduledItemId',
    'reminderType',
    'offsetMinutes',
    'status',
    'scheduledAt',
    'sentAt',
    'createdAt',
    'updatedAt',
  ],
  agent: [
    ...common,
    'type',
    'presetKey',
    'businessModeKey',
    'isSystem',
    'isCustom',
    'isProtected',
    'publishedVersionId',
    'archivedAt',
  ],
  preset: [
    'key',
    'name',
    'description',
    'type',
    'businessModeKey',
    'compatibleBusinessModes',
  ],
  catalog: [
    'id',
    'key',
    'label',
    'name',
    'type',
    'required',
    'description',
    'code',
    'value',
  ],
};
const behavior = [
  'tone',
  'language',
  'allowedLanguages',
  'roleTitle',
  'formality',
  'introductionPolicy',
  'aiDisclosure',
  'preferredClosing',
  'behaviorLimits',
  'proactivity',
  'responseStyle',
  'guardrails',
  'serviceAudience',
];

/** Explicit output contracts, recursively including nested JSON. No denylist or entity spread. */
export function leadFlowClientResponse(
  value: unknown,
  route: LeadFlowClientRoute,
): unknown {
  if (Array.isArray(value))
    return value.map((row) => leadFlowClientResponse(row, route));
  if (!value || typeof value !== 'object') return value;
  const row = value as Record<string, unknown>,
    kind = route.kind;
  if (kind === 'agenda')
    return {
      version: 'v1',
      mode: row.mode,
      items: Array.isArray(row.items)
        ? row.items
            .filter(
              (entry: Record<string, unknown>) =>
                entry.source === 'scheduled_item',
            )
            .map((entry) => pick(entry, fields.agenda))
        : [],
    };
  if (Array.isArray(row.items))
    return {
      ...pick(row, [
        'total',
        'limit',
        'offset',
        'businessModeKey',
        'isCustomBusinessMode',
      ]),
      items: leadFlowClientResponse(row.items, route),
    };
  if (kind === 'catalog') {
    if (Array.isArray(row.fields))
      return {
        ...pickLeaves(row, ['businessModeKey', 'businessModeResolved']),
        fields: row.fields
          .filter((entry: Record<string, unknown>) => !entry.developerOnly)
          .map((entry: Record<string, unknown>) => ({
            ...pickLeaves(entry, [
              'key',
              'label',
              'type',
              'origin',
              'group',
              'essential',
              'developerOnly',
            ]),
            ...(Array.isArray(entry.options)
              ? {
                  options: entry.options.map((option) =>
                    pickLeaves(option, ['value', 'label']),
                  ),
                }
              : {}),
          })),
      };
    if (Array.isArray(row.reasons))
      return {
        ...pickLeaves(row, ['businessMode']),
        reasons: row.reasons.map((reason) =>
          pickLeaves(reason, ['code', 'label', 'scope']),
        ),
      };
    return pickLeaves(row, fields.catalog);
  }
  if (kind === 'settings')
    return {
      quickReplies: Array.isArray(row.quickReplies)
        ? row.quickReplies.map((item) =>
            pick(item, ['id', 'shortcut', 'title', 'message', 'enabled']),
          )
        : [],
      tags: Array.isArray(row.tags)
        ? row.tags.map((item) => pick(item, ['id', 'name', 'color', 'status']))
        : [],
    };
  if (kind === 'contact' && row.contact)
    return {
      contact: pick(row.contact, fields.contact),
      profile: pick(row.profile, ['avatarUrl']),
      methods: Array.isArray(row.methods)
        ? row.methods.map((item) =>
            pick(item, ['id', 'type', 'value', 'label', 'isPrimary']),
          )
        : [],
      addresses: Array.isArray(row.addresses)
        ? row.addresses.map((item) =>
            pick(item, [
              'id',
              'type',
              'street',
              'number',
              'complement',
              'district',
              'city',
              'state',
              'postalCode',
              'country',
            ]),
          )
        : [],
    };
  if (kind === 'opportunity' && route.path.endsWith('/events'))
    return pick(row, [
      'id',
      'opportunityId',
      'eventType',
      'title',
      'description',
      'actorType',
      'actorUserId',
      'createdAt',
    ]);
  if (kind === 'opportunity' && route.path.endsWith('/tags'))
    return pick(row, [
      'id',
      'tagId',
      'name',
      'color',
      'opportunityId',
      'createdAt',
    ]);
  if (kind === 'opportunity' && route.path.endsWith('/lead-score'))
    return pick(row, [
      'opportunityId',
      'score',
      'category',
      'temperature',
      'goal',
      'computedAt',
      'calculatedAt',
      'policyVersion',
    ]);
  if (kind === 'outbound')
    return {
      ...pick(row, fields.outbound),
      ...(row.conversation
        ? {
            conversation: leadFlowClientResponse(row.conversation, {
              ...route,
              kind: 'conversation',
            }),
          }
        : {}),
      ...(row.message
        ? {
            message: leadFlowClientResponse(row.message, {
              ...route,
              kind: 'message',
            }),
          }
        : {}),
    };
  const result = pick(row, fields[kind]);
  if (kind === 'message' && Array.isArray(row.attachments))
    result.attachments = row.attachments.map((item) =>
      pick(item, ['id', 'kind', 'mimeType', 'name', 'status']),
    );
  if (kind === 'conversation') {
    result.metadata = pickLeaves(row.metadata, [
      'isPinned',
      'isFavorite',
      'isMuted',
      'isBlocked',
      'pinned',
      'favorite',
      'muted',
      'blocked',
    ]);
    if (row.qualificationStatus === 'internal') result.contactId = null;
  }
  if (kind === 'agent') {
    result.avatarConfig = pickLeaves(row.avatarConfig, [
      'preset',
      'skin',
      'outfit',
      'accentColor',
      'icon',
    ]);
    result.readiness = pickLeaves(row.readiness, ['score', 'level']);
    result.behaviorConfig = pickLeaves(row.behaviorConfig, behavior);
    result.handoffPolicy = pickLeaves(row.handoffPolicy, [
      'triggers',
      'target',
      'slaMinutes',
      'transferOpportunityOnHandoff',
    ]);
    result.crmPolicy = pickLeaves(row.crmPolicy, [
      'createLeads',
      'updateStageOnQualified',
    ]);
    result.channelPolicy = pickLeaves(row.channelPolicy, [
      'allowedChannels',
      'defaultChannel',
    ]);
    result.channels = Array.isArray(row.channels)
      ? row.channels.map((item) =>
          pick(item, ['id', 'channelKey', 'provider', 'status']),
        )
      : [];
  }
  return result;
}
@Injectable()
export class LeadFlowClientAreaInterceptor implements NestInterceptor {
  intercept(execution: ExecutionContext, next: CallHandler) {
    const request = execution.switchToHttp().getRequest<ClientAreaRequest>();
    if (!request.clientAreaContext) return next.handle();
    const route = leadFlowClientAreaRoute(
      request.method,
      (request.route as { path?: string })?.path ?? '',
    );
    if (!route) return next.handle();
    // Guards predate Multer; parsed media intent is checked again in its product controller.
    if (!request.clientAreaContext.memberAccess?.[route.module]?.available)
      throw new NotFoundException('Resource is not available.');
    return next
      .handle()
      .pipe(map((value: unknown) => leadFlowClientResponse(value, route)));
  }
}
