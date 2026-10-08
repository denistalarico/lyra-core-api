import { Logger } from '@nestjs/common';
import {
  CREATIVE_VIDEO_GENERATION_ENABLED_ENV,
  CREATIVE_VIDEO_GENERATIVE_PROVIDER_ENV,
  CREATIVE_VIDEO_PRICING_CONFIRMED_ENV,
  CREATIVE_VIDEO_UGC_PROVIDER_ENV,
  type CreativeVideoGenerationConfigService,
  HEYGEN_API_KEY_ENV,
  VIDU_API_KEY_ENV,
} from './creative-video-generation-config';
import {
  type CreativeVideoMode,
  DisabledVideoGenerationProvider,
  type VideoGenerationProvider,
} from './creative-video-generation.provider';
import { HeyGenVideoGenerationProvider } from './heygen-video-generation.provider';
import { ViduVideoGenerationProvider } from './vidu-video-generation.provider';

/**
 * CS4-B — which provider runs which mode. Deliberately not a router: one
 * provider per mode, chosen by configuration at boot.
 *
 *   generative_reel → Vidu
 *   ugc_avatar      → HeyGen
 *
 * A future provider (Runway, Pletor, Creatify, …) is one more adapter and one
 * more allowed value of the mode's setting; the schema already stores
 * `provider` per operation, so nothing structural changes.
 *
 * Two different questions, kept apart:
 *   - `forMode(mode)`: may NEW work be accepted? Needs the global kill switch,
 *     the mode's provider setting, its dedicated key and a confirmed pricing
 *     version. Otherwise a Disabled provider answers (503, nothing enqueued).
 *   - `byId(id)`: can a job ALREADY submitted be followed (status, download)?
 *     Needs only the key: turning the kill switch off stops new submits but
 *     never abandons a paid job mid-flight.
 *
 * Misconfiguration never fails the boot and is logged by env NAME only.
 */
export class CreativeVideoProviderRegistry {
  constructor(
    private readonly accepting: ReadonlyMap<
      CreativeVideoMode,
      VideoGenerationProvider
    >,
    private readonly known: ReadonlyMap<string, VideoGenerationProvider>,
  ) {}

  forMode(mode: CreativeVideoMode): VideoGenerationProvider {
    return (
      this.accepting.get(mode) ?? new DisabledVideoGenerationProvider(mode)
    );
  }

  /** May this provider receive a NEW submit right now? */
  canSubmit(providerId: string): boolean {
    return [...this.accepting.values()].some(
      (provider) => provider.id === providerId && provider.enabled,
    );
  }

  byId(providerId: string): VideoGenerationProvider | null {
    return this.known.get(providerId) ?? null;
  }

  all(): VideoGenerationProvider[] {
    return [...this.known.values()];
  }
}

export function bindVideoGenerationProviders(
  config: CreativeVideoGenerationConfigService,
): CreativeVideoProviderRegistry {
  const logger = new Logger('VideoGenerationProviderBinding');
  const known = new Map<string, VideoGenerationProvider>();
  const accepting = new Map<CreativeVideoMode, VideoGenerationProvider>();
  const confirmed = config.confirmedPricingVersions;

  const candidates: {
    mode: CreativeVideoMode;
    setting: string;
    settingEnv: string;
    id: string;
    key: string;
    keyEnv: string;
    build: () => VideoGenerationProvider;
  }[] = [
    {
      mode: 'generative_reel',
      setting: config.generativeProvider,
      settingEnv: CREATIVE_VIDEO_GENERATIVE_PROVIDER_ENV,
      id: 'vidu',
      key: config.viduApiKey,
      keyEnv: VIDU_API_KEY_ENV,
      build: () => new ViduVideoGenerationProvider(config),
    },
    {
      mode: 'ugc_avatar',
      setting: config.ugcProvider,
      settingEnv: CREATIVE_VIDEO_UGC_PROVIDER_ENV,
      id: 'heygen',
      key: config.heygenApiKey,
      keyEnv: HEYGEN_API_KEY_ENV,
      build: () => new HeyGenVideoGenerationProvider(config),
    },
  ];

  for (const candidate of candidates) {
    if (!candidate.key) continue;
    const provider = candidate.build();
    known.set(provider.id, provider);
  }

  if (!config.enabled) {
    logger.log(
      `video generation disabled (${CREATIVE_VIDEO_GENERATION_ENABLED_ENV} is not true)`,
    );
    return new CreativeVideoProviderRegistry(accepting, known);
  }

  for (const candidate of candidates) {
    if (candidate.setting === 'disabled') continue;
    if (candidate.setting === 'invalid') {
      logger.error(
        `${candidate.settingEnv} has an unsupported value; ${candidate.mode} stays disabled`,
      );
      continue;
    }
    const provider = known.get(candidate.id);
    if (!provider) {
      logger.error(
        `${candidate.settingEnv}=${candidate.id} but ${candidate.keyEnv} is not set; ${candidate.mode} stays disabled`,
      );
      continue;
    }
    if (!confirmed.has(provider.pricingVersion)) {
      logger.error(
        `${candidate.mode}: pricing ${provider.pricingVersion} not listed in ${CREATIVE_VIDEO_PRICING_CONFIRMED_ENV}; stays disabled`,
      );
      continue;
    }
    accepting.set(candidate.mode, provider);
    logger.log(
      `video generation mode=${candidate.mode} provider=${provider.id} pricing=${provider.pricingVersion}`,
    );
  }
  return new CreativeVideoProviderRegistry(accepting, known);
}
