import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SocialCampaignMonitorService } from './social-campaign-monitor.service';

@Injectable()
export class SocialCampaignMonitorScheduler {
  private readonly logger = new Logger(SocialCampaignMonitorScheduler.name);

  constructor(private readonly monitor: SocialCampaignMonitorService) {}

  @Cron('*/15 * * * *')
  async tick() {
    if (process.env.SOCIAL_CAMPAIGN_MONITOR_ENABLED === 'false') return;
    try {
      await this.monitor.evaluateAll();
    } catch (error) {
      this.logger.error(
        `Social campaign monitor failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }
}
