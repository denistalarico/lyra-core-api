import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ScheduledItemEntity } from '../../appointments/entities/scheduled-item.entity';
import { LeadScoreQueryService } from '../../crm/lead-score/services/lead-score-query.service';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { CrmOpportunityFieldCatalogService } from '../../crm/services/crm-opportunity-field-catalog.service';
import { InboxConversationEntity } from '../../inbox/entities/inbox-conversation.entity';
import { InboxMessageEntity } from '../../inbox/entities/inbox-message.entity';
import { InboxSettingsEntity } from '../../inbox/entities/inbox-settings.entity';
import { LeadFlowAutomationRunEntity } from '../entities/leadflow-automation-run.entity';
import {
  LeadFlowAutomationContextSignal,
  type LeadFlowAutomationAppointmentContext,
  type LeadFlowAutomationContextGapRecord,
  type LeadFlowAutomationContextSubject,
} from '../types/leadflow-automation-context.types';

const AGENCY_CONNECTION = 'agency';

/** Ownership states that mean a human is handling the conversation. */
const HANDOFF_STATES = new Set(['handoff_requested', 'human_active']);

/** Scheduled item types the Agenda treats as a commitment with a contact. */
const APPOINTMENT_TYPES = new Set(['event', 'meeting', 'call']);

/** Storage status → canonical lifecycle, mirroring `AppointmentsService`. */
const LIFECYCLE_BY_STORAGE_STATUS: Record<string, string> = {
  completed: 'completed',
  canceled: 'canceled',
  missed: 'no_show',
  postponed: 'rescheduled',
};

export interface LeadFlowAutomationLoadRequest {
  tenantId: string;
  workspaceId: string;
  subjects: Partial<Record<LeadFlowAutomationContextSubject, string>>;
  /** Signals wanted across every automation matched by this delivery. */
  signals: Set<LeadFlowAutomationContextSignal>;
  /** Message that triggered the delivery, when the payload names one. */
  triggerMessageId: string | null;
  /** Automations whose own run history is needed, with their subject key. */
  automationIds: string[];
  now: Date;
}

export interface LeadFlowAutomationLoadedContext {
  /** Signals shared by every automation matched by the same delivery. */
  shared: Partial<Record<LeadFlowAutomationContextSignal, unknown>>;
  /**
   * Subjects the envelope did not name but a canonical record links to.
   *
   * An appointment event names only the commitment, yet the conversation and
   * the opportunity it belongs to were written by the Agenda itself when the
   * commitment was created. Following that link is not a guess, so it is
   * reported here and recorded on the snapshot like any other subject.
   */
  derivedSubjects: Partial<Record<LeadFlowAutomationContextSubject, string>>;
  /** Signals derived from each automation's own history. */
  perAutomation: Map<
    string,
    Partial<Record<LeadFlowAutomationContextSignal, unknown>>
  >;
  gaps: LeadFlowAutomationContextGapRecord[];
  cost: {
    queryCount: number;
    durationMs: number;
    sources: Array<{ source: string; queryCount: number; durationMs: number }>;
  };
}

/**
 * Reads canonical state for the signals a delivery's automations actually need.
 *
 * Batched per delivery, not per automation: ten automations reacting to the
 * same event ask the same questions about the same conversation, and answering
 * them ten times would put the cost of a workspace's configuration onto every
 * message that arrives.
 *
 * Every read is bounded. The conversation and the opportunity are single-row
 * lookups; the message history is never scanned — the reply signal is a count
 * limited to one row, and keyword matching reads only the message that
 * triggered the delivery. A recipe that does not ask about messages issues no
 * message query at all.
 */
@Injectable()
export class LeadFlowAutomationContextLoaderService {
  constructor(
    @InjectRepository(InboxConversationEntity, AGENCY_CONNECTION)
    private readonly conversations: Repository<InboxConversationEntity>,
    @InjectRepository(InboxMessageEntity, AGENCY_CONNECTION)
    private readonly messages: Repository<InboxMessageEntity>,
    @InjectRepository(InboxSettingsEntity, AGENCY_CONNECTION)
    private readonly inboxSettings: Repository<InboxSettingsEntity>,
    @InjectRepository(CrmOpportunityEntity, AGENCY_CONNECTION)
    private readonly opportunities: Repository<CrmOpportunityEntity>,
    @InjectRepository(ScheduledItemEntity, AGENCY_CONNECTION)
    private readonly appointments: Repository<ScheduledItemEntity>,
    @InjectRepository(LeadFlowAutomationRunEntity, AGENCY_CONNECTION)
    private readonly runs: Repository<LeadFlowAutomationRunEntity>,
    private readonly leadScore: LeadScoreQueryService,
    private readonly fieldCatalog: CrmOpportunityFieldCatalogService,
  ) {}

  async load(
    request: LeadFlowAutomationLoadRequest,
  ): Promise<LeadFlowAutomationLoadedContext> {
    const startedAt = Date.now();
    const shared: LeadFlowAutomationLoadedContext['shared'] = {};
    const perAutomation: LeadFlowAutomationLoadedContext['perAutomation'] =
      new Map();
    const derivedSubjects: LeadFlowAutomationLoadedContext['derivedSubjects'] =
      {};
    const gaps: LeadFlowAutomationContextGapRecord[] = [];
    const sources: LeadFlowAutomationLoadedContext['cost']['sources'] = [];
    let queryCount = 0;

    const scope = {
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
    };
    let conversationId = request.subjects.inbox_conversation ?? null;
    let opportunityId = request.subjects.crm_opportunity ?? null;
    const appointmentId = request.subjects.scheduled_item ?? null;
    const want = (signal: LeadFlowAutomationContextSignal) =>
      request.signals.has(signal);

    /** Runs one source, recording what it cost. */
    const source = async <T>(name: string, run: () => Promise<T>) => {
      const at = Date.now();
      const before = queryCount;
      const value = await run();
      sources.push({
        source: name,
        queryCount: queryCount - before,
        durationMs: Date.now() - at,
      });
      return value;
    };

    // --- the commitment itself, and the links it carries -------------------
    // Runs first: everything else about an agenda event — the conversation to
    // reply in, the opportunity it belongs to — is reachable only through the
    // commitment, so resolving it late would make the other signals look
    // unreachable when they are merely unread.
    if (want(LeadFlowAutomationContextSignal.AppointmentContext)) {
      if (!appointmentId) {
        gaps.push(
          gap(
            LeadFlowAutomationContextSignal.AppointmentContext,
            'missing_context',
            'O evento não identifica o compromisso a que a automação se refere.',
          ),
        );
      } else {
        await source('scheduled_item', async () => {
          queryCount += 1;
          const item = await this.appointments.findOne({
            where: { id: appointmentId, ...scope, deletedAt: IsNull() },
          });
          if (!item) {
            gaps.push(
              gap(
                LeadFlowAutomationContextSignal.AppointmentContext,
                'missing_context',
                'O compromisso referido pelo evento não foi encontrado neste workspace.',
              ),
            );
            return;
          }

          // The guard the phase exists for. Each part answers a question the
          // automation cannot avoid asking — when it happens, what it is, who
          // it is with, where a reply would arrive — so a commitment missing
          // any of them is reported as unusable rather than half-processed.
          const startsAt = item.startAt ?? item.dueAt;
          const missing: string[] = [];
          if (!startsAt) missing.push('data e hora');
          if (!APPOINTMENT_TYPES.has(item.type)) missing.push('tipo');
          if (!item.contactId && !item.sourceConversationId) {
            missing.push('contato');
          }
          if (!item.sourceChannel?.trim()) missing.push('canal');
          if (missing.length > 0 || !startsAt) {
            gaps.push(
              gap(
                LeadFlowAutomationContextSignal.AppointmentContext,
                'missing_context',
                `O compromisso não informa ${formatList(missing)}; sem isso a automação de agenda não tem sobre o que agir.`,
              ),
            );
            return;
          }

          const confirmationDueAt = item.metadata?.confirmationDueAt;
          const value: LeadFlowAutomationAppointmentContext = {
            appointmentId: item.id,
            startsAt: startsAt.toISOString(),
            timezone: item.timezone,
            serviceRef: item.type,
            channel: item.sourceChannel,
            contactId: item.contactId,
            conversationId: item.sourceConversationId,
            opportunityId: item.sourceOpportunityId,
            lifecycleStatus: appointmentLifecycleStatus(item),
            confirmationDueAt:
              typeof confirmationDueAt === 'string' &&
              !Number.isNaN(Date.parse(confirmationDueAt))
                ? new Date(confirmationDueAt).toISOString()
                : null,
          };
          shared[LeadFlowAutomationContextSignal.AppointmentContext] = value;

          // Links written by the Agenda in the same transaction as the event.
          if (!conversationId && item.sourceConversationId) {
            conversationId = item.sourceConversationId;
            derivedSubjects.inbox_conversation = item.sourceConversationId;
          }
          if (!opportunityId && item.sourceOpportunityId) {
            opportunityId = item.sourceOpportunityId;
            derivedSubjects.crm_opportunity = item.sourceOpportunityId;
          }
        });
      }
    }

    // --- conversation: handoff -------------------------------------------
    if (want(LeadFlowAutomationContextSignal.HandoffActive) && conversationId) {
      const subjectId = conversationId;
      await source('inbox_conversation', async () => {
        queryCount += 1;
        const conversation = await this.conversations.findOne({
          where: { id: subjectId, ...scope },
          select: { id: true, ownershipState: true },
        });
        if (!conversation) {
          gaps.push(
            gap(
              LeadFlowAutomationContextSignal.HandoffActive,
              'missing_context',
              'A conversa referida pelo evento não foi encontrada neste workspace.',
            ),
          );
          return;
        }
        shared[LeadFlowAutomationContextSignal.HandoffActive] =
          HANDOFF_STATES.has(conversation.ownershipState);
      });
    }

    // --- conversation: did the lead reply ---------------------------------
    if (want(LeadFlowAutomationContextSignal.LeadReplied) && conversationId) {
      const subjectId = conversationId;
      await source('inbox_message_reply', async () => {
        queryCount += 1;
        // Existence, not history: one row answers the question.
        const inbound = await this.messages.findOne({
          where: { conversationId: subjectId, ...scope, direction: 'inbound' },
          select: { id: true },
          order: { createdAt: 'DESC' },
        });
        shared[LeadFlowAutomationContextSignal.LeadReplied] = inbound !== null;
      });
    }

    // --- the triggering message, for keyword and intent matching ----------
    const wantsMessageContent =
      want(LeadFlowAutomationContextSignal.MatchedKeywords) ||
      want(LeadFlowAutomationContextSignal.MatchedIntents);
    if (wantsMessageContent) {
      if (!request.triggerMessageId) {
        for (const signal of [
          LeadFlowAutomationContextSignal.MatchedKeywords,
          LeadFlowAutomationContextSignal.MatchedIntents,
        ]) {
          if (want(signal)) {
            gaps.push(
              gap(
                signal,
                'missing_context',
                'O evento não identifica uma mensagem, então não há texto a analisar.',
              ),
            );
          }
        }
      } else {
        await source('inbox_message_content', async () => {
          queryCount += 1;
          const message = await this.messages.findOne({
            where: { id: request.triggerMessageId as string, ...scope },
            select: { id: true, content: true },
          });
          if (!message) {
            for (const signal of [
              LeadFlowAutomationContextSignal.MatchedKeywords,
              LeadFlowAutomationContextSignal.MatchedIntents,
            ]) {
              if (want(signal)) {
                gaps.push(
                  gap(
                    signal,
                    'missing_context',
                    'A mensagem do evento não foi encontrada neste workspace.',
                  ),
                );
              }
            }
            return;
          }
          if (want(LeadFlowAutomationContextSignal.MatchedKeywords)) {
            shared[LeadFlowAutomationContextSignal.MatchedKeywords] = tokenize(
              message.content,
            );
          }
          if (want(LeadFlowAutomationContextSignal.MatchedIntents)) {
            // Intent classification is owned by Agents and not persisted as a
            // structured signal yet. Guessing from the same text would be the
            // secret heuristic the design forbids.
            gaps.push(
              gap(
                LeadFlowAutomationContextSignal.MatchedIntents,
                'dependency_unavailable',
                'Classificação de intenção ainda não é produzida como sinal estruturado.',
              ),
            );
          }
        });
      }
    }

    // --- business hours ---------------------------------------------------
    if (want(LeadFlowAutomationContextSignal.InsideBusinessHours)) {
      await source('inbox_settings', async () => {
        queryCount += 1;
        const settings = await this.inboxSettings.findOne({ where: scope });
        const inside = evaluateBusinessHours(
          settings?.businessHours ?? null,
          request.now,
        );
        if (inside === null) {
          gaps.push(
            gap(
              LeadFlowAutomationContextSignal.InsideBusinessHours,
              'missing_context',
              'O horário comercial deste workspace não está configurado.',
            ),
          );
          return;
        }
        shared[LeadFlowAutomationContextSignal.InsideBusinessHours] = inside;
      });
    }

    // --- lead score, from the CRM's canonical read -------------------------
    if (want(LeadFlowAutomationContextSignal.LeadScore)) {
      if (!opportunityId) {
        gaps.push(
          gap(
            LeadFlowAutomationContextSignal.LeadScore,
            'missing_context',
            'O evento não identifica a oportunidade cuja pontuação seria lida.',
          ),
        );
      } else {
        const subjectId = opportunityId;
        await source('crm_lead_score', async () => {
          queryCount += 1;
          const score = await this.leadScore.getForOpportunity(
            scope,
            subjectId,
          );
          if (score.availability !== 'available' || score.score === null) {
            gaps.push(
              gap(
                LeadFlowAutomationContextSignal.LeadScore,
                'missing_context',
                'Esta oportunidade ainda não foi pontuada.',
              ),
            );
            return;
          }
          shared[LeadFlowAutomationContextSignal.LeadScore] = score.score;
        });
      }
    }

    // --- opportunity fields ------------------------------------------------
    if (want(LeadFlowAutomationContextSignal.PresentFields)) {
      if (!opportunityId) {
        gaps.push(
          gap(
            LeadFlowAutomationContextSignal.PresentFields,
            'missing_context',
            'O evento não identifica a oportunidade cujos campos seriam lidos.',
          ),
        );
      } else {
        const subjectId = opportunityId;
        await source('crm_opportunity_fields', async () => {
          queryCount += 1;
          const opportunity = await this.opportunities.findOne({
            where: { id: subjectId, ...scope },
          });
          if (!opportunity) {
            gaps.push(
              gap(
                LeadFlowAutomationContextSignal.PresentFields,
                'missing_context',
                'A oportunidade referida pelo evento não foi encontrada.',
              ),
            );
            return;
          }
          queryCount += 1;
          const catalog = await this.fieldCatalog.listFields(
            { tenantId: request.tenantId, workspaceId: request.workspaceId },
            opportunity.businessMode ?? null,
          );
          shared[LeadFlowAutomationContextSignal.PresentFields] = catalog.fields
            .filter((spec) => isPresent(readField(opportunity, spec.key)))
            .map((spec) => spec.key);
        });
      }
    }

    // --- the automations' own history --------------------------------------
    const wantsHistory =
      want(LeadFlowAutomationContextSignal.AttemptsSoFar) ||
      want(LeadFlowAutomationContextSignal.HoursSinceLastRun);
    if (wantsHistory && request.automationIds.length > 0) {
      await source('automation_runs', async () => {
        queryCount += 1;
        // Own table, so this is not a cross-domain read. One grouped query
        // answers for every automation matched by this delivery.
        const query = this.runs
          .createQueryBuilder('run')
          .select('run.automation_id', 'automationId')
          .addSelect('COUNT(*)', 'attempts')
          .addSelect('MAX(run.created_at)', 'lastRunAt')
          .where('run.tenant_id = :tenantId', { tenantId: request.tenantId })
          .andWhere('run.workspace_id = :workspaceId', {
            workspaceId: request.workspaceId,
          })
          .andWhere('run.automation_id IN (:...ids)', {
            ids: request.automationIds,
          });
        // The commitment wins when the event names one: an attempt cap on a
        // no-show recovery is per appointment, not per lead. Counting across a
        // contact's whole history would let one past no-show exhaust the budget
        // of every commitment they ever book.
        const historySubject =
          request.subjects.scheduled_item ??
          request.subjects.inbox_conversation ??
          request.subjects.crm_opportunity ??
          null;
        if (historySubject) {
          query.andWhere(
            `(
              run.input_snapshot #>> '{contextSnapshot,subjects,scheduled_item}' = :historySubject
              OR run.input_snapshot #>> '{contextSnapshot,subjects,inbox_conversation}' = :historySubject
              OR run.input_snapshot #>> '{contextSnapshot,subjects,crm_opportunity}' = :historySubject
            )`,
            { historySubject },
          );
        }
        const rows = await query.groupBy('run.automation_id').getRawMany<{
          automationId: string;
          attempts: string;
          lastRunAt: Date | null;
        }>();

        const byAutomation = new Map(
          rows.map((row) => [row.automationId, row]),
        );
        for (const automationId of request.automationIds) {
          const row = byAutomation.get(automationId);
          const entry: Partial<
            Record<LeadFlowAutomationContextSignal, unknown>
          > = {};
          if (want(LeadFlowAutomationContextSignal.AttemptsSoFar)) {
            entry[LeadFlowAutomationContextSignal.AttemptsSoFar] = row
              ? Number(row.attempts)
              : 0;
          }
          if (want(LeadFlowAutomationContextSignal.HoursSinceLastRun)) {
            entry[LeadFlowAutomationContextSignal.HoursSinceLastRun] =
              row?.lastRunAt
                ? Math.max(
                    0,
                    (request.now.getTime() -
                      new Date(row.lastRunAt).getTime()) /
                      3_600_000,
                  )
                : Number.MAX_SAFE_INTEGER;
          }
          perAutomation.set(automationId, entry);
        }
      });
    }

    return {
      shared,
      perAutomation,
      derivedSubjects,
      gaps,
      cost: { queryCount, durationMs: Date.now() - startedAt, sources },
    };
  }

  /** Ids the loader would need but could not batch. Exposed for tests. */
  static handoffStates(): string[] {
    return [...HANDOFF_STATES];
  }
}

function gap(
  signal: LeadFlowAutomationContextSignal,
  kind: LeadFlowAutomationContextGapRecord['gap'],
  detail: string,
): LeadFlowAutomationContextGapRecord {
  return { signal, gap: kind, detail, dependency: null };
}

/**
 * Canonical lifecycle of a commitment.
 *
 * `metadata.appointmentStatus` is what the Appointments domain writes and is
 * therefore authoritative; the storage `status` column is only the legacy
 * projection kept for the shared Calendar surface.
 */
function appointmentLifecycleStatus(item: ScheduledItemEntity): string {
  const explicit = item.metadata?.appointmentStatus;
  if (typeof explicit === 'string' && explicit.trim()) return explicit;
  return LIFECYCLE_BY_STORAGE_STATUS[item.status] ?? 'confirmed';
}

/** "data e hora, tipo e contato" — a list an operator can read out loud. */
function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? 'os dados mínimos';
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

/**
 * Whether `now` falls inside the configured window.
 *
 * Returns null when there is no usable configuration — never a default of
 * "open", which would let a follow-up go out at 3am on the strength of a
 * setting nobody filled in.
 */
export function evaluateBusinessHours(
  config: Record<string, unknown> | null,
  now: Date,
): boolean | null {
  if (!config || typeof config !== 'object') return null;
  if (config.enabled === false) return true;

  const days = config.days;
  if (!Array.isArray(days) || days.length === 0) return null;

  const timezone =
    typeof config.timezone === 'string' ? config.timezone : 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const weekday = parts
    .find((part) => part.type === 'weekday')
    ?.value.toLowerCase();
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  const current = `${hour}:${minute}`;

  const today = (days as Array<Record<string, unknown>>).find(
    (entry) => String(entry.day).toLowerCase() === weekday,
  );
  if (!today) return null;
  if (today.enabled === false) return false;

  const start = typeof today.start === 'string' ? today.start : null;
  const end = typeof today.end === 'string' ? today.end : null;
  if (!start || !end) return null;

  return current >= start && current <= end;
}

/** Lowercased words of a message, for keyword matching. Never persisted. */
function tokenize(content: string): string[] {
  return [
    ...new Set(
      content
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 1),
    ),
  ];
}

function readField(opportunity: CrmOpportunityEntity, field: string): unknown {
  if (field.startsWith('businessContext.')) {
    return opportunity.businessContext?.[
      field.slice('businessContext.'.length)
    ];
  }
  return (opportunity as unknown as Record<string, unknown>)[field];
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Re-exported so the module can register the entities this service reads. */
export const LEADFLOW_CONTEXT_LOADER_ENTITIES = [
  InboxConversationEntity,
  InboxMessageEntity,
  InboxSettingsEntity,
  CrmOpportunityEntity,
  ScheduledItemEntity,
  LeadFlowAutomationRunEntity,
];
