import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiCostLedgerService } from '../../ai-costs/ai-cost-ledger.service';
import { normalizeEmail, normalizePhone } from '../form-submission.normalizer';
import type { NormalizedLead } from '../forms.types';

/**
 * F4 (§6.5.4, D-F12): AI fallback for e-mail leads the rules could not read.
 * Same provider style as the LeadFlow briefing extraction: OpenAI chat
 * completions with a strict JSON schema. Only the body text (≤ 8 KB) leaves.
 *
 * Env: FORMS_EMAIL_AI_MODE (live|disabled; default live when OPENAI_API_KEY
 * exists), FORMS_EMAIL_AI_MODEL, FORMS_EMAIL_AI_DAILY_LIMIT (per workspace).
 */

const MAX_INPUT = 8_000;
const TIMEOUT_MS = 20_000;

export type AiLeadResult = { lead: NormalizedLead; message: string | null };

type Scope = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId: string | null;
};

const SCHEMA = {
  name: 'form_email_lead',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'email', 'phone', 'company', 'position', 'message'],
    properties: Object.fromEntries(
      ['name', 'email', 'phone', 'company', 'position', 'message'].map(
        (key) => [key, { type: ['string', 'null'] }],
      ),
    ),
  },
};

@Injectable()
export class FormEmailAiExtractor {
  private readonly logger = new Logger(FormEmailAiExtractor.name);
  readonly apiKey = process.env.OPENAI_API_KEY?.trim() ?? '';
  readonly mode =
    (process.env.FORMS_EMAIL_AI_MODE ?? (this.apiKey ? 'live' : 'disabled')) ===
      'live' && Boolean(this.apiKey)
      ? 'live'
      : 'disabled';
  readonly model = (process.env.FORMS_EMAIL_AI_MODEL ?? 'gpt-5.6-terra').trim();
  readonly dailyLimit = Math.max(
    0,
    Number(process.env.FORMS_EMAIL_AI_DAILY_LIMIT ?? 200) || 0,
  );

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly ledger: AiCostLedgerService,
  ) {}

  get enabled() {
    return this.mode === 'live' && this.dailyLimit > 0;
  }

  /** null when disabled, over the daily cap, or the provider failed (rules result stays). */
  async extract(
    text: string,
    scope: Scope,
    submissionId: string,
  ): Promise<AiLeadResult | null> {
    if (!this.enabled || !text.trim()) return null;
    const [{ count }] = await this.dataSource.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM form_submissions
        WHERE tenant_id = $1 AND workspace_id = $2 AND source = 'email'
          AND normalized->>'extractedBy' = 'ai'
          AND created_at >= date_trunc('day', now())`,
      [scope.tenantId, scope.workspaceId],
    );
    if (count >= this.dailyLimit) return null;

    const started = new Date();
    let body: Record<string, unknown> | null = null;
    let ok = false;
    try {
      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          body: JSON.stringify({
            model: this.model,
            messages: [
              {
                role: 'system',
                content:
                  'Extract the contact who filled a website form from this e-mail sent by the site. ' +
                  'The sender address is usually the server, not the person. ' +
                  'Return null for anything not written in the text. Never invent data. ' +
                  '"message" is what the person wrote, if any.',
              },
              { role: 'user', content: text.slice(0, MAX_INPUT) },
            ],
            response_format: { type: 'json_schema', json_schema: SCHEMA },
          }),
        },
      );
      body = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      ok = response.ok;
      if (!ok) return null;
      const content = (
        body?.choices as Array<{ message?: { content?: string } }> | undefined
      )?.[0]?.message?.content;
      const parsed = JSON.parse(content ?? 'null') as Record<
        string,
        string | null
      > | null;
      if (!parsed) return null;
      const clean = (value: string | null | undefined, max: number) =>
        typeof value === 'string' && value.trim()
          ? value.trim().slice(0, max)
          : null;
      return {
        lead: {
          name: clean(parsed.name, 200),
          email: parsed.email ? normalizeEmail(parsed.email) : null,
          phone: parsed.phone ? normalizePhone(parsed.phone) : null,
          company: clean(parsed.company, 200),
          position: clean(parsed.position, 120),
        },
        message: clean(parsed.message, 5000),
      };
    } catch (error) {
      this.logger.warn(
        `Form e-mail AI extraction failed: ${(error as Error).message}`,
      );
      return null;
    } finally {
      // A 2xx consumed provider work: record it even if parsing failed.
      if (body?.usage)
        await this.recordCost(
          scope,
          submissionId,
          body,
          ok,
          started,
          Math.min(text.length, MAX_INPUT),
        );
    }
  }

  private async recordCost(
    scope: Scope,
    submissionId: string,
    body: Record<string, unknown>,
    ok: boolean,
    occurredAt: Date,
    inputChars: number,
  ) {
    const usage = body.usage as {
      prompt_tokens?: number;
      completion_tokens?: number;
    };
    const metrics: Record<string, number> = {};
    if (typeof usage.prompt_tokens === 'number')
      metrics.input_tokens = usage.prompt_tokens;
    if (typeof usage.completion_tokens === 'number')
      metrics.output_tokens = usage.completion_tokens;
    try {
      await this.ledger.record([
        {
          ...scope,
          sourceDomain: 'agency.forms',
          sourceType: 'form_email_ai_extraction',
          sourceId: submissionId,
          logicalType: 'form_submission',
          logicalId: submissionId,
          operationKind: 'lead_extraction',
          provider: 'openai',
          model: typeof body.model === 'string' ? body.model : this.model,
          outcome: ok ? 'succeeded' : 'failed',
          usage: {
            unit: 'tokens',
            quantity:
              metrics.input_tokens !== undefined &&
              metrics.output_tokens !== undefined
                ? String(metrics.input_tokens + metrics.output_tokens)
                : null,
            metrics: Object.keys(metrics).length ? metrics : null,
          },
          unitPrice: null,
          pricingVersion: null,
          // No confirmed per-token price for this model yet (same as contracts/briefing).
          cost: { status: 'unknown', reason: 'unpriced' },
          occurredAt,
          correlation: { contentItemId: null, projectId: null, taskId: null },
          metadata: { inputChars },
        },
      ]);
    } catch (error) {
      this.logger.warn(
        `Form AI cost not recorded: ${(error as Error).message}`,
      );
    }
  }
}
