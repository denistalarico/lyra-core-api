import { Injectable, OnModuleInit } from '@nestjs/common';

export type OrionProviderMode = 'disabled' | 'mock' | 'live';

/** Published price per million tokens, used only when no env price is set. */
const KNOWN_PRICES: Record<
  string,
  { input: number; cached: number; output: number }
> = {
  'gpt-5.6-terra': { input: 2.5, cached: 0.25, output: 15 },
  'gpt-5.6-luna': { input: 1, cached: 0.1, output: 6 },
};

/**
 * OR4 — runtime config of the Orion assistant.
 *
 * Same shape as `SocialAnalyticsInsightConfigService`: read `process.env`
 * directly, default to `disabled` so no deployment starts paying a provider
 * because the code shipped, and refuse to boot in `live` without a key, a
 * model and an HTTPS endpoint.
 *
 * `disabled` is the kill switch of the plan's rollback table: the frontend
 * keeps the deterministic interpreter (OR1) and never calls the endpoint.
 * `mock` exercises the whole path — budget, tools, permissions, audit —
 * without a provider and says so in its own text.
 *
 * Prices are USD per million tokens. An env price wins; a known model falls
 * back to its published price; an unknown model with no env price leaves the
 * cost `unknown` in the cost ledger and the reservation stands as the
 * estimate, so the monthly ceiling is never computed from a zero.
 */
@Injectable()
export class OrionConfigService implements OnModuleInit {
  readonly mode = resolveMode();

  /** OR6 kill switch: shipping the integration never enables chat turns. */
  readonly teamChatEnabled = booleanFlag('ORION_TEAM_CHAT_ENABLED', false);

  /** OR7 kill switch: `@Orion` in the agency↔client chat. */
  readonly clientChatEnabled = booleanFlag('ORION_CLIENT_CHAT_ENABLED', false);

  readonly endpoint = (
    process.env.ORION_PROVIDER_BASE_URL ?? 'https://api.openai.com/v1'
  ).replace(/\/$/, '');

  readonly apiKey = resolveApiKey(this.endpoint);

  readonly model = process.env.ORION_MODEL?.trim() || 'gpt-5.6-terra';

  readonly timeoutMs = boundedInteger(
    'ORION_TIMEOUT_MS',
    30_000,
    1_000,
    120_000,
  );

  readonly maxAttempts = boundedInteger('ORION_MAX_ATTEMPTS', 2, 1, 3);

  /** Provider round trips per turn: tool rounds plus the final answer. */
  readonly maxRounds = boundedInteger('ORION_MAX_TOOL_ROUNDS', 3, 1, 5);

  /** D-OR-1: per tenant, per calendar month (UTC). */
  readonly tenantMonthlyBudgetUsd = boundedDecimal(
    'ORION_TENANT_MONTHLY_BUDGET_USD',
    5,
    0,
    10_000,
  );

  /** D-OR-1: LLM turns per user per rolling hour. */
  readonly userHourlyLimit = boundedInteger(
    'ORION_USER_HOURLY_LIMIT',
    30,
    1,
    1_000,
  );

  /**
   * Held against the month before the call. A turn measured at ~US$ 0,02–0,04
   * (AO-09) with up to `maxRounds` round trips; the reservation is what keeps
   * concurrent turns from overshooting the ceiling together.
   */
  readonly turnReserveUsd = boundedDecimal(
    'ORION_TURN_RESERVE_USD',
    0.08,
    0.001,
    5,
  );

  /** IANA zone for "hoje", "este mês" and the agenda of the day. */
  readonly timeZone =
    process.env.ORION_TIME_ZONE?.trim() || 'America/Sao_Paulo';

  readonly inputUsdPerMillion = optionalDecimal('ORION_INPUT_USD_PER_MILLION');
  readonly cachedInputUsdPerMillion = optionalDecimal(
    'ORION_CACHED_INPUT_USD_PER_MILLION',
  );
  readonly outputUsdPerMillion = optionalDecimal(
    'ORION_OUTPUT_USD_PER_MILLION',
  );

  get available(): boolean {
    return this.mode !== 'disabled';
  }

  /** The rates used to price a turn, or null when the model is unpriced. */
  prices(): { input: number; cached: number; output: number } | null {
    const known = KNOWN_PRICES[this.model];
    const input = this.inputUsdPerMillion ?? known?.input;
    const output = this.outputUsdPerMillion ?? known?.output;
    const cached = this.cachedInputUsdPerMillion ?? known?.cached ?? input;
    if (input === undefined || output === undefined || cached === undefined)
      return null;
    return { input, cached, output };
  }

  /** Versioned like the CS6 price tables: a new rate is a new version. */
  pricingVersion(): string | null {
    const prices = this.prices();
    if (!prices) return null;
    return `orion.${this.model}.usd-mtok.${prices.input}/${prices.cached}/${prices.output}`.slice(
      0,
      80,
    );
  }

  onModuleInit(): void {
    if (this.mode === 'live') this.assertLive();
  }

  private assertLive(): void {
    if (!this.apiKey || !this.model)
      throw new Error('orion_live_configuration_missing');

    const parsed = new URL(this.endpoint);
    const local =
      parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !local)
      throw new Error('orion_endpoint_must_use_https');
  }
}

function resolveMode(): OrionProviderMode {
  const value = process.env.ORION_PROVIDER_MODE ?? 'disabled';
  if (value === 'disabled' || value === 'mock' || value === 'live')
    return value;
  throw new Error('orion_provider_mode_invalid');
}

/**
 * An explicit key wins. `OPENAI_API_KEY` is used only when the endpoint really
 * is OpenAI — a misconfigured base URL must not receive the platform's key.
 */
function resolveApiKey(endpoint: string): string {
  const explicit = process.env.ORION_PROVIDER_API_KEY?.trim();
  if (explicit) return explicit;

  try {
    if (new URL(endpoint).hostname !== 'api.openai.com') return '';
  } catch {
    return '';
  }

  return process.env.OPENAI_API_KEY?.trim() ?? '';
}

function boundedInteger(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function boundedDecimal(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function optionalDecimal(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function booleanFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}
