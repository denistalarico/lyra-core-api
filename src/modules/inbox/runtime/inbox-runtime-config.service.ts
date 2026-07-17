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
  readonly apiKey = process.env.INBOX_PROVIDER_API_KEY ?? '';
  readonly transcriptionModel = process.env.INBOX_TRANSCRIPTION_MODEL ?? '';
  readonly decisionModel = process.env.INBOX_DECISION_MODEL ?? '';
  readonly visionModel = process.env.INBOX_VISION_MODEL ?? '';
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
  readonly maxAttempts = boundedNumber('INBOX_PROVIDER_MAX_ATTEMPTS', 2, 1, 3);

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
    if (!this.apiKey || !model)
      throw new Error('inbox_live_provider_configuration_missing');
    const parsed = new URL(this.endpoint);
    const local =
      parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !local)
      throw new Error('inbox_provider_endpoint_must_use_https');
  }
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
