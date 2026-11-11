import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SocialInsightsService } from './social-insights.service';

/**
 * Hourly observation of Google Trends "Trending now", independent of page
 * views — without it the week and month rankings would only cover the hours
 * someone happened to open the Social Overview.
 */
@Injectable()
export class SocialInsightsScheduler {
  private readonly logger = new Logger(SocialInsightsScheduler.name);

  constructor(private readonly insights: SocialInsightsService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<number> {
    try {
      return await this.insights.collectTrends();
    } catch (error) {
      this.logger.error(
        `Social trends collection failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return 0;
    }
  }
}
