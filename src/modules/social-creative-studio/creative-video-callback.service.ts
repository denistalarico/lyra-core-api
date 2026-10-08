import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreativeVideoProviderRegistry } from './creative-video-generation.binding';
import type { VideoGenerationCallbackRequest } from './creative-video-generation.provider';

const PROVIDER_ID = /^[a-z][a-z0-9_-]{1,30}$/;

/**
 * CS4-B — provider callbacks are WAKE-UP HINTS, nothing more.
 *
 * A verified callback only moves the matching generation's `available_at` to
 * now, so the worker polls it on its next tick instead of at the next
 * interval. Its body is never trusted for status, output, cost or scope: the
 * worker re-reads the job through the provider's authenticated API. Hence:
 *   - replay or duplicate delivery: harmless (one more early poll);
 *   - unknown job id: nothing matches, same empty answer — no existence leak;
 *   - unverifiable signature: ignored, polling still completes the job;
 *   - Company Context: never read from the callback; the job id maps to the
 *     generation, which carries its own scope.
 */
@Injectable()
export class CreativeVideoCallbackService {
  private readonly logger = new Logger(CreativeVideoCallbackService.name);

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly providers: CreativeVideoProviderRegistry,
  ) {}

  async handle(
    providerId: string,
    request: VideoGenerationCallbackRequest,
  ): Promise<void> {
    const provider = PROVIDER_ID.test(providerId)
      ? this.providers.byId(providerId)
      : null;
    if (!provider) return;
    let parsed: { jobId: string } | null = null;
    try {
      parsed = provider.parseCallback(request);
    } catch {
      parsed = null;
    }
    if (!parsed) {
      this.logger.warn(
        `video callback provider=${provider.id} ignored (unverified)`,
      );
      return;
    }
    await this.dataSource.query(
      `UPDATE social_creative_video_generations generation
          SET available_at = now(), updated_at = now()
         FROM social_creative_video_generation_operations op
        WHERE op.provider = $1 AND op.provider_job_id = $2
          AND generation.id = op.generation_id
          AND generation.status = 'processing'
          AND generation.available_at > now()`,
      [provider.id, parsed.jobId],
    );
  }
}
