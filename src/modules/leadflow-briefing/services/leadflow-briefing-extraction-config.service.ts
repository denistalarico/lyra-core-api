import { Injectable, OnModuleInit } from '@nestjs/common';

export type LeadFlowBriefingExtractionProviderMode = 'disabled' | 'mock' | 'live';

/**
 * Runtime config for the F4-003 extraction provider. Mirrors
 * InboxRuntimeConfigService's shape (inbox/runtime/inbox-runtime-config.service.ts):
 * reads process.env directly (no ConfigModule registration — same as Inbox),
 * defaults to 'disabled' so nothing calls a paid API until explicitly
 * configured, and refuses to boot in 'live' mode without a usable key/model.
 */
@Injectable()
export class LeadFlowBriefingExtractionConfigService implements OnModuleInit {
  readonly mode = mode();
  readonly endpoint = (
    process.env.LEADFLOW_BRIEFING_EXTRACTION_PROVIDER_BASE_URL ??
    'https://api.openai.com/v1'
  ).replace(/\/$/, '');
  readonly apiKey = providerApiKey(this.endpoint);
  readonly model =
    process.env.LEADFLOW_BRIEFING_EXTRACTION_MODEL ?? 'gpt-5.6-luna';
  readonly timeoutMs = boundedNumber(
    'LEADFLOW_BRIEFING_EXTRACTION_TIMEOUT_MS',
    20_000,
    1_000,
    60_000,
  );
  readonly maxAttempts = boundedNumber(
    'LEADFLOW_BRIEFING_EXTRACTION_MAX_ATTEMPTS',
    2,
    1,
    3,
  );
  readonly maxImagesPerJob = boundedNumber(
    'LEADFLOW_BRIEFING_EXTRACTION_MAX_IMAGES_PER_JOB',
    3,
    0,
    5,
  );
  readonly maxPdfPages = boundedNumber(
    'LEADFLOW_BRIEFING_EXTRACTION_MAX_PDF_PAGES',
    30,
    1,
    200,
  );
  readonly maxExtractedChars = boundedNumber(
    'LEADFLOW_BRIEFING_EXTRACTION_MAX_EXTRACTED_CHARS',
    40_000,
    1_000,
    200_000,
  );
  readonly dailyBudgetCents = boundedNumber(
    'LEADFLOW_BRIEFING_EXTRACTION_DAILY_BUDGET_CENTS',
    500,
    0,
    100_000,
  );
  readonly reserveCents = boundedNumber(
    'LEADFLOW_BRIEFING_EXTRACTION_RESERVE_CENTS',
    5,
    0,
    10_000,
  );

  onModuleInit(): void {
    if (this.mode === 'live') this.assertLive();
  }

  private assertLive(): void {
    if (!this.apiKey || !this.model)
      throw new Error('leadflow_briefing_extraction_live_configuration_missing');
    const parsed = new URL(this.endpoint);
    const local =
      parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !local)
      throw new Error('leadflow_briefing_extraction_endpoint_must_use_https');
  }
}

function mode(): LeadFlowBriefingExtractionProviderMode {
  const value =
    process.env.LEADFLOW_BRIEFING_EXTRACTION_PROVIDER_MODE ?? 'disabled';
  if (value === 'disabled' || value === 'mock' || value === 'live')
    return value;
  throw new Error('leadflow_briefing_extraction_provider_mode_invalid');
}

function providerApiKey(endpoint: string): string {
  const explicit =
    process.env.LEADFLOW_BRIEFING_EXTRACTION_PROVIDER_API_KEY?.trim();
  if (explicit) return explicit;

  try {
    const parsed = new URL(endpoint);
    if (parsed.hostname !== 'api.openai.com') return '';
  } catch {
    return '';
  }

  return process.env.OPENAI_API_KEY?.trim() ?? '';
}

function boundedNumber(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
