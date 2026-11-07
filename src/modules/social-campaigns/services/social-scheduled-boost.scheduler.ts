import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SocialAdActionsConfigService } from './social-ad-actions-config.service';
import { SocialScheduledBoostService } from './social-scheduled-boost.service';

/** Executes Planner-authorized boosts once their post is published. */
@Injectable()
export class SocialScheduledBoostScheduler {
  private readonly logger = new Logger(SocialScheduledBoostScheduler.name);
  private running = false;

  constructor(
    private readonly scheduledBoosts: SocialScheduledBoostService,
    private readonly config: SocialAdActionsConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    // Meta writes off = nothing may spend; pending rows simply wait.
    if (!this.config.writesEnabled || this.running) return;
    this.running = true;
    try {
      const executed = await this.scheduledBoosts.runDue();
      if (executed > 0)
        this.logger.log(`Scheduled boosts executed: ${executed}`);
    } catch (error) {
      this.logger.error(
        `Scheduled boost run failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    } finally {
      this.running = false;
    }
  }
}
