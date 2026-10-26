import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ClientAreaBridgeRegistry } from '../../common/client-area-bridge/client-area-bridge.registry';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import type { RequestContext } from '../../common/context/request-context.interface';
import { LeadFlowAgentService } from '../leadflow-agents/services/leadflow-agent.service';
import type { CreateOrionTurnDto } from './dto/create-orion-turn.dto';
import type { OrionToolCallRecord, OrionTurnSurface } from './entities';
import {
  OrionBudgetService,
  type OrionReservation,
  type OrionTurnScope,
  type OrionUsage,
} from './orion-budget.service';
import { OrionConfigService } from './orion-config.service';
import {
  ORION_PROMPT_VERSION,
  orionToolMessage,
  orionTurnMessages,
  type OrionAudience,
  type OrionSessionContext,
} from './orion-prompt';
import { OrionProvider } from './orion.provider';
import { OrionLimitError, OrionProviderError } from './orion.errors';
import type {
  OrionCard,
  OrionProposal,
  OrionStatusResponse,
  OrionTurnLimit,
  OrionTurnResponse,
  OrionUiAction,
} from './orion.types';
import type { OrionAccess } from './tools/orion-tool-access.service';
import { orionToolDefinitions } from './tools/orion-tool-catalog';
import { OrionToolsService } from './tools/orion-tools.service';

const MAX_CALLS_PER_ROUND = 4;
const MAX_ANSWER_CHARS = 4000;

/**
 * OR4 — one Orion turn: free text the deterministic interpreter did not
 * understand (D-OR-6), answered by the LLM with read tools that run with the
 * caller's permissions, inside the tenant's monthly ceiling (D-OR-1).
 *
 * Order: kill switch → reservation (budget + hourly limit, under a tenant
 * lock) → provider rounds (tool calls executed here, never by the model) →
 * settle the reservation and the cost ledger. A limit never reaches the
 * provider: the answer falls back to the Help Center, without AI, and says
 * so naturally.
 */
@Injectable()
export class OrionService {
  constructor(
    private readonly config: OrionConfigService,
    private readonly provider: OrionProvider,
    private readonly budget: OrionBudgetService,
    private readonly tools: OrionToolsService,
    private readonly agents: LeadFlowAgentService,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    @Optional() private readonly clientArea?: ClientAreaBridgeRegistry,
  ) {}

  async status(
    ctx: RequestContext,
    access: OrionAccess,
  ): Promise<OrionStatusResponse> {
    if (!this.config.available)
      return { available: false, aiLimitReached: false };
    const tenantId =
      access.kind === 'client_area' ? access.context.tenantId : ctx.tenantId;
    return {
      available: true,
      aiLimitReached: !(await this.budget.monthlyBudgetAvailable(tenantId)),
    };
  }

  async runTurn(
    ctx: RequestContext,
    access: OrionAccess,
    dto: CreateOrionTurnDto,
    invocation: { surface: OrionTurnSurface } = {
      surface: 'operations_room',
    },
  ): Promise<OrionTurnResponse> {
    if (!this.config.available)
      throw new ServiceUnavailableException({
        code: 'orion_disabled',
        message: 'O Orion está desligado.',
      });
    const text = dto.text?.trim() ?? '';
    if (!text)
      throw new BadRequestException({
        code: 'orion_text_required',
        message: 'Escreva uma pergunta para o Orion.',
      });

    const scope = turnScope(ctx, access, invocation.surface);
    let reservation: OrionReservation;
    try {
      reservation = await this.budget.reserve({
        scope,
        idempotencyKey: dto.clientTurnId ?? randomUUID(),
        provider: this.provider.providerName,
        model: this.provider.modelName,
        promptVersion: ORION_PROMPT_VERSION,
      });
    } catch (error) {
      if (!(error instanceof OrionLimitError)) throw error;
      if (
        error.code === 'orion_turn_in_progress' ||
        error.code === 'orion_turn_replayed'
      )
        throw new ConflictException({
          code: error.code,
          message: 'Esta pergunta já foi enviada.',
        });
      return this.fallback(
        text,
        access,
        error.code === 'orion_budget_exhausted'
          ? 'monthly_budget'
          : 'hourly_rate',
      );
    }

    const started = Date.now();
    const usage: OrionUsage = {};
    const records: OrionToolCallRecord[] = [];
    let card: OrionCard | null = null;
    let uiAction: OrionUiAction | null = null;
    let proposal: OrionProposal | null = null;
    let attempts = 0;
    let rounds = 0;
    let answer: string | null = null;

    try {
      const session = await this.sessionContext(ctx, access, dto.agentId);
      // OR7: in the agency↔client chat the client reads the answer, whoever
      // mentioned the Orion.
      const audience: OrionAudience =
        invocation.surface === 'client_chat' ? 'client_chat' : access.kind;
      const messages = orionTurnMessages(
        audience,
        session,
        text,
        invocation.surface,
      );
      const definitions = orionToolDefinitions(audience);
      for (let round = 1; round <= this.config.maxRounds; round += 1) {
        rounds = round;
        const completion = await this.provider
          .complete({
            messages,
            tools: definitions,
            allowTools: round < this.config.maxRounds,
            idempotencyKey: `${reservation.id}:${round}`,
          })
          .catch((error: unknown) => {
            if (error instanceof OrionProviderError) attempts += error.attempts;
            throw error;
          });
        attempts += completion.attempts;
        addUsage(usage, completion.usage);
        if (!completion.toolCalls.length) {
          answer = completion.content;
          break;
        }
        const calls = completion.toolCalls.slice(0, MAX_CALLS_PER_ROUND);
        messages.push({
          role: 'assistant',
          content: completion.content,
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments },
          })),
        });
        for (const call of calls) {
          const execution = await this.tools.execute(call, {
            ctx,
            access,
            requestText: text,
            callKey: `${reservation.id}:${records.length}`,
            surface: invocation.surface,
          });
          records.push(execution.record);
          if (execution.card) card = mergeCards(card, execution.card);
          if (execution.uiAction) uiAction = execution.uiAction;
          if (execution.proposal) proposal = execution.proposal;
          messages.push(orionToolMessage(call.id, execution.payload));
        }
      }
      if (!answer) throw new OrionProviderError('orion_response_invalid', 0);
    } catch (error) {
      const code =
        error instanceof OrionProviderError
          ? error.code
          : 'orion_internal_error';
      await this.budget.fail(reservation, {
        errorCode: code,
        usage,
        rounds,
        attempts,
        latencyMs: Date.now() - started,
        toolCalls: records,
      });
      if (error instanceof OrionProviderError)
        throw new ServiceUnavailableException({
          code: error.code,
          message: 'O Orion não conseguiu responder agora.',
        });
      throw error;
    }

    await this.budget.succeed(reservation, {
      usage,
      rounds,
      attempts,
      latencyMs: Date.now() - started,
      toolCalls: records,
    });
    return {
      text: answer.slice(0, MAX_ANSWER_CHARS),
      card,
      uiAction,
      proposal,
      meta: {
        ai: true,
        mode: this.config.mode === 'mock' ? 'mock' : 'live',
        limit: null,
        turnId: reservation.id,
        tools: records.map((record) => record.name),
      },
    };
  }

  /** D-OR-1: at a limit, commands and Help Center keep working, without AI. */
  private async fallback(
    text: string,
    access: OrionAccess,
    limit: OrionTurnLimit,
  ): Promise<OrionTurnResponse> {
    const help = await this.tools
      .searchHelp(text, { access })
      .catch(() => ({ card: undefined }));
    const card = help.card ?? null;
    const reason =
      limit === 'monthly_budget'
        ? 'As respostas com IA do Orion chegaram ao limite deste mês e voltam no próximo.'
        : 'Você já fez muitas perguntas ao Orion na última hora; as respostas com IA voltam em instantes.';
    const rest = card
      ? ' Enquanto isso, os comandos da sala continuam funcionando, e separei artigos da Central de Ajuda que podem ajudar.'
      : ' Enquanto isso, os comandos da sala continuam funcionando (digite /ajuda para ver a lista).';
    return {
      text: reason + rest,
      card,
      uiAction: null,
      proposal: null,
      meta: {
        ai: false,
        mode: this.config.mode === 'mock' ? 'mock' : 'live',
        limit,
        turnId: null,
        tools: [],
      },
    };
  }

  private async sessionContext(
    ctx: RequestContext,
    access: OrionAccess,
    agentId: string | undefined,
  ): Promise<OrionSessionContext> {
    const [firstName, selectedAgentName] = await Promise.all([
      this.firstName(ctx, access).catch(() => null),
      agentId
        ? this.agents
            .list(ctx)
            .then(
              (listed) =>
                listed.items.find((agent) => agent.id === agentId)?.name ??
                null,
            )
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    return {
      firstName,
      companyName:
        access.kind === 'client_area'
          ? access.context.companyDisplayName
          : (ctx.managedContext?.companyName ??
            ctx.managedContext?.clientName ??
            null),
      selectedAgentName,
      today: new Intl.DateTimeFormat('pt-BR', {
        timeZone: this.config.timeZone,
        dateStyle: 'full',
      }).format(new Date()),
      timeZone: this.config.timeZone,
    };
  }

  private async firstName(
    ctx: RequestContext,
    access: OrionAccess,
  ): Promise<string | null> {
    let name: string | undefined;
    if (access.kind === 'client_area') {
      const names = await this.clientArea?.resolveActorNames(
        access.context.tenantId,
        [access.context.userId],
      );
      name = names?.[access.context.userId];
    } else if (ctx.userId) {
      const rows: Array<{ display_name: string }> = await this.dataSource.query(
        `SELECT display_name FROM user_profile WHERE tenant_id = $1 AND user_id = $2 LIMIT 1`,
        [ctx.tenantId, ctx.userId],
      );
      name = rows[0]?.display_name;
    }
    const first = name?.trim().split(/\s+/)[0];
    return first ? first.slice(0, 40) : null;
  }
}

/** The turn's scope, from the authenticated principal only. */
function turnScope(
  ctx: RequestContext,
  access: OrionAccess,
  surface: OrionTurnSurface,
): OrionTurnScope {
  if (access.kind === 'client_area') {
    const context = access.context;
    return {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      agencyClientId: context.agencyClientId,
      companyContextId: context.companyContextId,
      userId: context.userId,
      principal: 'client_area',
      surface,
    };
  }
  if (!ctx.userId)
    throw new BadRequestException('Authenticated user context is required.');
  const company = resolveCompanyAwareScope(ctx);
  return {
    tenantId: company.tenantId,
    workspaceId: company.workspaceId,
    agencyClientId: company.agencyClientId,
    companyContextId: company.companyContextId,
    userId: ctx.userId,
    principal: 'agency',
    surface,
  };
}

function addUsage(total: OrionUsage, next: OrionUsage): void {
  for (const key of [
    'inputTokens',
    'cachedInputTokens',
    'outputTokens',
  ] as const)
    if (next[key] !== undefined) total[key] = (total[key] ?? 0) + next[key];
}

function mergeCards(current: OrionCard | null, next: OrionCard): OrionCard {
  if (!current) return next;
  const seen = new Set(current.items.map((item) => item.title));
  return {
    kind: 'help_links',
    items: [
      ...current.items,
      ...next.items.filter((item) => !seen.has(item.title)),
    ].slice(0, 6),
  };
}
