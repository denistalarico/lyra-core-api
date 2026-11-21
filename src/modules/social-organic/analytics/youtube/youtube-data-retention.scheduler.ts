import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  YoutubeDataRetentionService,
  youtubeDataRetentionEnabled,
} from './youtube-data-retention.service';

/**
 * Daily YouTube data retention sweep (03:30 server time). Daily keeps every
 * deadline of the YouTube policy (7 days after a revocation in Lyra) with room
 * for a failed night. Brake: `SOCIAL_YOUTUBE_DATA_RETENTION_ENABLED=false`.
 */
@Injectable()
export class YoutubeDataRetentionScheduler {
  private readonly logger = new Logger(YoutubeDataRetentionScheduler.name);

  constructor(private readonly retention: YoutubeDataRetentionService) {}

  @Cron('0 30 3 * * *', {
    name: 'youtube-data-retention',
    waitForCompletion: true,
  })
  async tick(): Promise<void> {
    if (!youtubeDataRetentionEnabled()) return;
    try {
      await this.retention.sweep();
    } catch (error) {
      // The name alone: a driver error's message can carry statement fragments.
      this.logger.error(
        `YouTube data retention sweep failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }
}
