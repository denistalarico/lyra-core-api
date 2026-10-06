import { Logger } from '@nestjs/common';
import {
  CREATIVE_IMAGE_GENERATION_PROVIDER_ENV,
  type CreativeGenerationConfigService,
} from './creative-generation-config';
import {
  DisabledImageGenerationProvider,
  type ImageGenerationProvider,
} from './creative-image-generation.provider';
import { OpenAIImageGenerationProvider } from './openai-image-generation.provider';

/**
 * CS3.3 — picks the `ImageGenerationProvider` once, at module init.
 *
 * Fail closed, never fail the boot: anything short of an explicit
 * `CREATIVE_IMAGE_GENERATION_PROVIDER=openai` WITH a usable key binds
 * `DisabledImageGenerationProvider`, so the API keeps answering 503
 * `image_generation_unavailable` and enqueues nothing. A misconfiguration is
 * logged by env NAME only — never the value.
 */
export function bindImageGenerationProvider(
  config: CreativeGenerationConfigService,
): ImageGenerationProvider {
  const logger = new Logger('ImageGenerationProviderBinding');
  const setting = config.imageProvider;

  if (setting === 'openai') {
    if (config.openAiApiKey) {
      logger.log(
        `image generation provider=openai model=${config.imageModel} timeoutMs=${config.imageTimeoutMs}`,
      );
      return new OpenAIImageGenerationProvider(config);
    }
    logger.error(
      `${CREATIVE_IMAGE_GENERATION_PROVIDER_ENV}=openai but no API key is configured; image generation stays disabled`,
    );
  } else if (setting === 'invalid') {
    logger.error(
      `${CREATIVE_IMAGE_GENERATION_PROVIDER_ENV} has an unsupported value; image generation stays disabled`,
    );
  }
  return new DisabledImageGenerationProvider();
}
