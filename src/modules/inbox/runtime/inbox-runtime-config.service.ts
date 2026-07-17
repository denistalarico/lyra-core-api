import { Injectable, OnModuleInit } from '@nestjs/common';

export type InboxProviderMode = 'disabled' | 'mock' | 'live';

@Injectable()
export class InboxRuntimeConfigService implements OnModuleInit {
  readonly workersEnabled =
    process.env.INBOX_RUNTIME_WORKERS_ENABLED === 'true';
  readonly realtimeEnabled = process.env.INBOX_REALTIME_ENABLED === 'true';
  readonly transcriptionMode = mode('INBOX_TRANSCRIPTION_PROVIDER_MODE');
  readonly decisionMode = mode('INBOX_DECISION_PROVIDER_MODE');
  readonly multimodalEnabled = process.env.INBOX_MULTIMODAL_ENABLED !== 'false';
  readonly visionFallbackEnabled =
    process.env.INBOX_VISION_FALLBACK_ENABLED === 'true';
  readonly autoReplyEnabled = false;
  readonly autoCrmEnabled = false;
  readonly endpoint = (
    process.env.INBOX_PROVIDER_BASE_URL ?? 'https://api.openai.com/v1'
  ).replace(/\/$/, '');
  readonly apiKey = providerApiKey(this.endpoint);
  readonly transcriptionModel =
    process.env.INBOX_TRANSCRIPTION_MODEL ?? 'gpt-4o-mini-transcribe';
  readonly decisionModel = process.env.INBOX_DECISION_MODEL ?? 'gpt-5.6-terra';
  readonly visionModel = process.env.INBOX_VISION_MODEL ?? '';
  readonly activationSessionId = process.env.INBOX_LIVE_SESSION_ID ?? '';
  readonly transcriptionProcessorVersion =
    process.env.INBOX_TRANSCRIPTION_PROCESSOR_VERSION ?? 'transcription-v1';
  readonly promptVersion =
    process.env.INBOX_DECISION_PROMPT_VERSION ?? 'agent-decision-v1';
  readonly visionProcessorVersion =
    process.env.INBOX_VISION_PROCESSOR_VERSION ?? 'vision-v1';
  readonly timeoutMs = boundedNumber(
    'INBOX_PROVIDER_TIMEOUT_MS',
    20_000,
    1_000,
    60_000,
  );
  readonly maxAudioBytes = boundedNumber(
    'INBOX_TRANSCRIPTION_MAX_BYTES',
    15 * 1024 * 1024,
    1024,
    25 * 1024 * 1024,
  );
  readonly maxImagesPerRun = boundedNumber('INBOX_MAX_IMAGES_PER_RUN', 3, 0, 5);
  readonly maxImageBytes = boundedNumber(
    'INBOX_MAX_IMAGE_BYTES',
    8 * 1024 * 1024,
    64 * 1024,
    10 * 1024 * 1024,
  );
  readonly imageDetail = imageDetail();
  readonly maxAttempts = boundedNumber('INBOX_PROVIDER_MAX_ATTEMPTS', 2, 1, 3);
  readonly budgetUsd = boundedDecimal(
    'INBOX_PROVIDER_BUDGET_USD',
    2,
    0.01,
    100,
  );
  readonly maxDecisionCalls = boundedNumber(
    'INBOX_MAX_DECISION_CALLS',
    20,
    1,
    100,
  );
  readonly maxTranscriptionCalls = boundedNumber(
    'INBOX_MAX_TRANSCRIPTION_CALLS',
    10,
    1,
    100,
  );
  readonly maxVisionCalls = boundedNumber('INBOX_MAX_VISION_CALLS', 10, 0, 100);
  readonly maxImageInputs = boundedNumber('INBOX_MAX_IMAGE_INPUTS', 10, 0, 100);
  readonly decisionReserveUsd = boundedDecimal(
    'INBOX_DECISION_RESERVE_USD',
    0.1,
    0.001,
    10,
  );
  readonly transcriptionReserveUsd = boundedDecimal(
    'INBOX_TRANSCRIPTION_RESERVE_USD',
    0.02,
    0.001,
    10,
  );
  readonly visionReserveUsd = boundedDecimal(
    'INBOX_VISION_RESERVE_USD',
    0.05,
    0.001,
    10,
  );
  readonly decisionInputUsdPerMillion = optionalDecimal(
    'INBOX_DECISION_INPUT_USD_PER_MILLION',
  );
  readonly decisionCachedInputUsdPerMillion = optionalDecimal(
    'INBOX_DECISION_CACHED_INPUT_USD_PER_MILLION',
  );
  readonly decisionOutputUsdPerMillion = optionalDecimal(
    'INBOX_DECISION_OUTPUT_USD_PER_MILLION',
  );
  readonly transcriptionUsdPerMinute = optionalDecimal(
    'INBOX_TRANSCRIPTION_USD_PER_MINUTE',
  );

  onModuleInit(): void {
    if (this.transcriptionMode === 'live')
      this.assertLive(this.transcriptionModel);
    if (this.decisionMode === 'live') this.assertLive(this.decisionModel);
    if (
      this.visionFallbackEnabled &&
      this.decisionMode === 'live' &&
      !this.visionModel
    )
      throw new Error('inbox_vision_model_missing');
  }

  private assertLive(model: string): void {
    if (!this.apiKey || !model || !this.activationSessionId)
      throw new Error('inbox_live_provider_configuration_missing');
    const parsed = new URL(this.endpoint);
    const local =
      parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !local)
      throw new Error('inbox_provider_endpoint_must_use_https');
  }
}

function providerApiKey(endpoint: string): string {
  const explicit = process.env.INBOX_PROVIDER_API_KEY?.trim();
  if (explicit) return explicit;

  try {
    const parsed = new URL(endpoint);
    if (parsed.hostname !== 'api.openai.com') return '';
  } catch {
    return '';
  }

  return process.env.OPENAI_API_KEY?.trim() ?? '';
}

function imageDetail(): 'low' | 'auto' | 'high' {
  const value = process.env.INBOX_IMAGE_DETAIL ?? 'low';
  if (value === 'low' || value === 'auto' || value === 'high') return value;
  throw new Error('inbox_image_detail_invalid');
}

function mode(name: string): InboxProviderMode {
  const value = process.env[name] ?? 'disabled';
  if (value === 'disabled' || value === 'mock' || value === 'live')
    return value;
  throw new Error(`${name.toLowerCase()}_invalid`);
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

function optionalDecimal(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${name.toLowerCase()}_invalid`);
  return value;
}
