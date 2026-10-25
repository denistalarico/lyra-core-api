import { Injectable } from '@nestjs/common';
import type { OrionUsage } from './orion-budget.service';
import { OrionConfigService } from './orion-config.service';
import {
  OrionProviderError,
  type OrionProviderErrorCode,
} from './orion.errors';

export type OrionToolCall = { id: string; name: string; arguments: string };

export type OrionChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export type OrionToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type OrionCompletion = {
  content: string | null;
  toolCalls: OrionToolCall[];
  usage: OrionUsage;
  attempts: number;
};

/**
 * OR4 — the provider seam of the Orion. One call = one chat completion;
 * the tool loop lives in `OrionService`, which executes every tool itself
 * with the caller's permissions. Nothing outside this file names a vendor.
 *
 * `mock` answers with a fixed script (search the Help Center, or set the
 * theme when asked, then a closing text that says it is synthetic) so the
 * whole path — budget, tools, permission checks, audit — runs without a
 * provider.
 */
@Injectable()
export class OrionProvider {
  constructor(private readonly config: OrionConfigService) {}

  get providerName(): string {
    return this.config.mode === 'mock' ? 'mock' : 'openai-compatible';
  }

  get modelName(): string {
    return this.config.mode === 'mock' ? 'mock-orion-v1' : this.config.model;
  }

  async complete(input: {
    messages: OrionChatMessage[];
    tools: OrionToolDefinition[];
    allowTools: boolean;
    idempotencyKey: string;
  }): Promise<OrionCompletion> {
    if (this.config.mode === 'disabled')
      throw new OrionProviderError('orion_provider_disabled');
    if (this.config.mode === 'mock') return mockCompletion(input);

    const response = await this.request(
      {
        model: this.config.model,
        messages: input.messages,
        tools: input.tools,
        // The last round is forced to text, so a turn always ends in an answer.
        tool_choice: input.allowTools ? 'auto' : 'none',
        parallel_tool_calls: true,
      },
      input.idempotencyKey,
    );
    const body = (await response.response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const message = body ? firstMessage(body) : null;
    if (!message)
      throw new OrionProviderError('orion_response_invalid', response.attempts);

    const content =
      typeof message.content === 'string' && message.content.trim()
        ? message.content.trim()
        : null;
    const toolCalls = parseToolCalls(message.tool_calls);
    if (!content && !toolCalls.length)
      throw new OrionProviderError('orion_response_invalid', response.attempts);

    return {
      content,
      toolCalls: input.allowTools ? toolCalls : [],
      usage: providerUsage(body!),
      attempts: response.attempts,
    };
  }

  private async request(
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<{ response: Response; attempts: number }> {
    let lastCode: OrionProviderErrorCode = 'orion_provider_unavailable';

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt += 1) {
      try {
        const response = await fetch(
          `${this.config.endpoint}/chat/completions`,
          {
            method: 'POST',
            // A redirect would re-send the Authorization header to whatever
            // host the provider named; erroring is the only safe answer.
            redirect: 'error',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.config.apiKey}`,
              'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(this.config.timeoutMs),
          },
        );

        if (response.ok) return { response, attempts: attempt };

        lastCode =
          response.status === 429
            ? 'orion_provider_rate_limited'
            : response.status >= 500
              ? 'orion_provider_unavailable'
              : 'orion_provider_request_rejected';

        // A 4xx answers the same way every time; only 429 and 5xx retry.
        if (response.status < 500 && response.status !== 429)
          throw new OrionProviderError(lastCode, attempt);
      } catch (error) {
        if (error instanceof OrionProviderError) throw error;
        lastCode =
          error instanceof DOMException && error.name === 'TimeoutError'
            ? 'orion_provider_timeout'
            : 'orion_provider_unavailable';
      }

      if (attempt < this.config.maxAttempts)
        await new Promise((resolve) =>
          setTimeout(resolve, 150 * attempt + Math.floor(Math.random() * 100)),
        );
    }

    throw new OrionProviderError(lastCode, this.config.maxAttempts);
  }
}

function mockCompletion(input: {
  messages: OrionChatMessage[];
  allowTools: boolean;
}): OrionCompletion {
  const usedTools = input.messages.some((message) => message.role === 'tool');
  const question =
    [...input.messages].reverse().find((message) => message.role === 'user')
      ?.content ?? '';

  if (!usedTools && input.allowTools) {
    const theme = /\b(tema|modo)\s+(escuro|dark)\b/i.test(question)
      ? 'dark'
      : /\b(tema|modo)\s+(claro|light)\b/i.test(question)
        ? 'light'
        : null;
    return {
      content: null,
      toolCalls: [
        theme
          ? {
              id: 'mock-call-1',
              name: 'ui_action',
              arguments: JSON.stringify({ action: 'set_theme', value: theme }),
            }
          : {
              id: 'mock-call-1',
              name: 'search_help',
              arguments: JSON.stringify({ query: question.slice(0, 200) }),
            },
      ],
      usage: {},
      attempts: 1,
    };
  }

  return {
    content:
      'Resposta simulada (modo mock): o Orion ainda não está conectado a um ' +
      'modelo de IA. Consultei só as fontes permitidas para você.',
    toolCalls: [],
    usage: {},
    attempts: 1,
  };
}

function firstMessage(
  body: Record<string, unknown>,
): Record<string, unknown> | null {
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: unknown } | null)?.message;
  return message && typeof message === 'object'
    ? (message as Record<string, unknown>)
    : null;
}

function parseToolCalls(value: unknown): OrionToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const call = entry as {
      id?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    } | null;
    if (typeof call?.id !== 'string' || typeof call.function?.name !== 'string')
      return [];
    return [
      {
        id: call.id,
        name: call.function.name,
        arguments:
          typeof call.function.arguments === 'string'
            ? call.function.arguments
            : '{}',
      },
    ];
  });
}

function providerUsage(body: Record<string, unknown>): OrionUsage {
  const usage = body.usage as Record<string, unknown> | undefined;
  if (!usage) return {};
  const details = usage.prompt_tokens_details as
    | Record<string, unknown>
    | undefined;
  return {
    inputTokens: numberOrUndefined(usage.prompt_tokens),
    cachedInputTokens: numberOrUndefined(details?.cached_tokens),
    outputTokens: numberOrUndefined(usage.completion_tokens),
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}
