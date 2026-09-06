import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SocialPublicationRunService } from './social-publication-run.service';

@Injectable()
export class SocialPublicationScheduler {
  private readonly logger = new Logger(SocialPublicationScheduler.name);
  private running = false;

  constructor(private readonly runService: SocialPublicationRunService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<number> {
    if (this.running) return 0;

    this.running = true;
    try {
      return await this.runService.releaseScheduled();
    } catch (error) {
      this.logger.error(
        `Social publication scheduling cycle failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }
}
