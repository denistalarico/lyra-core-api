import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CompanyAwareScope } from '../../../common/context/company-aware-scope';
import { SocialAnalyticsInsightConfigService } from './social-analytics-insight-config.service';
import {
  SocialAnalyticsInsightProvider,
  type InsightMetricInput,
} from './social-analytics-insight.provider';
import { SocialAnalyticsInsightError } from './social-analytics-insight.errors';

export type SocialAnalyticsInsightRequest = {
  sectionTitle: string;
  channelLabel: string;
  since: string;
  until: string;
  metrics: InsightMetricInput[];
};

export type SocialAnalyticsInsightView = {
  body: string;
  generatedAt: string;
  model: string;
  promptVersion: string;
  /**
   * What the run cost, in cents, derived from the configured per-million rates.
   * Always an estimate — the provider reports tokens, not money — and flagged
   * as one so a future credit charge is not built on a number that pretends to
   * be an invoice line.
   */
  costCents: number;
  costIsEstimated: boolean;
};

/**
 * Generates one frozen insight for a dashboard section — Etapa 8.
 *
 * Nothing is persisted here. The card that holds the text is part of the layout
 * document, so the frontend writes it through the existing dashboard PATCH; a
 * second write path would mean two ways for a card to reach `layout` and two
 * places to keep the contract in sync.
 *
 * The scope is taken but not used for a query, deliberately: it is what the
 * cost log is keyed by, and taking it in the signature means a future credit
 * ledger has the tenant already at hand rather than needing the endpoint
 * re-plumbed.
 */
@Injectable()
export class SocialAnalyticsInsightService {
  private readonly logger = new Logger(SocialAnalyticsInsightService.name);

  constructor(
    private readonly config: SocialAnalyticsInsightConfigService,
    private readonly provider: SocialAnalyticsInsightProvider,
  ) {}

  get available(): boolean {
    return this.config.available;
  }

  async generate(
    scope: CompanyAwareScope,
    request: SocialAnalyticsInsightRequest,
  ): Promise<SocialAnalyticsInsightView> {
    const result = await this.provider.generate({
      idempotencyKey: randomUUID(),
      sectionTitle: request.sectionTitle,
      channelLabel: request.channelLabel,
      period: { since: request.since, until: request.until },
      metrics: request.metrics,
    });

    const costCents = this.estimateCents(
      result.usage.inputTokens ?? 0,
      result.usage.outputTokens ?? 0,
    );

    // Logged rather than written to a table: §6.3 defers the credit ledger, and
    // a log line carries the tenant, the model and the cents needed to
    // reconstruct a charge when that ledger arrives.
    this.logger.log(
      `social_analytics_insight tenant=${scope.tenantId} client=${
        scope.agencyClientId ?? '-'
      } company=${scope.companyContextId ?? '-'} model=${result.model} ` +
        `attempts=${result.attempts} latency_ms=${result.latencyMs} cost_cents=${costCents}`,
    );

    return {
      body: result.body,
      generatedAt: new Date().toISOString(),
      model: result.model,
      promptVersion: result.promptVersion,
      costCents,
      costIsEstimated: true,
    };
  }

  /**
   * Rounded up, never down.
   *
   * A run that cost a fraction of a cent still cost something, and a floor
   * would record a free run for every short generation — which is precisely the
   * population a retroactive charge would then miss.
   */
  private estimateCents(inputTokens: number, outputTokens: number): number {
    const cents =
      (inputTokens * this.config.inputCentsPerMillionTokens +
        outputTokens * this.config.outputCentsPerMillionTokens) /
      1_000_000;

    return cents > 0 ? Math.max(1, Math.ceil(cents)) : 0;
  }

  /** The HTTP status a failure code deserves. */
  static statusFor(error: SocialAnalyticsInsightError): number {
    switch (error.code) {
      case 'insight_provider_disabled':
      case 'insight_provider_unavailable':
      case 'insight_provider_timeout':
        return 503;
      case 'insight_provider_rate_limited':
        return 429;
      case 'insight_context_empty':
        return 400;
      default:
        return 502;
    }
  }

  /** The sentence the operator reads, per failure code. */
  static messageFor(error: SocialAnalyticsInsightError): string {
    switch (error.code) {
      case 'insight_provider_disabled':
        return 'A análise com o Orion não está habilitada neste ambiente.';
      case 'insight_provider_timeout':
        return 'O Orion demorou demais para responder. Tente novamente.';
      case 'insight_provider_rate_limited':
        return 'O Orion está recebendo muitas solicitações. Tente novamente em instantes.';
      case 'insight_context_empty':
        return 'Esta seção não tem métricas com valor para analisar.';
      default:
        return 'Não foi possível gerar a análise agora.';
    }
  }
}
