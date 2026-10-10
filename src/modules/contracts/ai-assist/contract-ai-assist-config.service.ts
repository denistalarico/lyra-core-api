import { Injectable, OnModuleInit } from '@nestjs/common';

export type ContractAiAssistMode = 'disabled' | 'mock' | 'live';

@Injectable()
export class ContractAiAssistConfigService implements OnModuleInit {
  readonly mode = resolveMode();
  readonly endpoint = (
    process.env.CONTRACT_AI_ASSIST_PROVIDER_BASE_URL ??
    'https://api.openai.com/v1'
  )
    .trim()
    .replace(/\/+$/, '');
  readonly apiKey = resolveApiKey(this.endpoint);
  readonly model = (
    process.env.CONTRACT_AI_ASSIST_MODEL ?? 'gpt-6.1-sol'
  ).trim();
  readonly timeoutMs = boundedNumber(
    'CONTRACT_AI_ASSIST_TIMEOUT_MS',
    60000,
    1000,
    120000,
  );
  readonly maxInputChars = boundedNumber(
    'CONTRACT_AI_ASSIST_MAX_INPUT_CHARS',
    80000,
    1,
    80000,
  );
  readonly dailyLimitPerWorkspace = boundedNumber(
    'CONTRACT_AI_ASSIST_DAILY_LIMIT_PER_WORKSPACE',
    30,
    0,
    1000,
  );

  onModuleInit(): void {
    if (this.mode !== 'live') return;
    if (!this.apiKey || !this.model)
      throw new Error('contract_ai_live_configuration_missing');
    const url = new URL(this.endpoint);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('contract_ai_endpoint_must_use_https');
  }
}

function resolveMode(): ContractAiAssistMode {
  const mode = process.env.CONTRACT_AI_ASSIST_PROVIDER_MODE ?? 'disabled';
  if (mode === 'disabled' || mode === 'mock' || mode === 'live') return mode;
  throw new Error('contract_ai_provider_mode_invalid');
}

function resolveApiKey(endpoint: string): string {
  const explicit = process.env.CONTRACT_AI_ASSIST_PROVIDER_API_KEY?.trim();
  if (explicit) return explicit;
  try {
    if (new URL(endpoint).hostname === 'api.openai.com')
      return process.env.OPENAI_API_KEY?.trim() ?? '';
  } catch {
    /* Invalid URLs fail boot when live. */
  }
  return '';
}

function boundedNumber(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}
