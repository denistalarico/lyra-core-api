import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { currentHourIn } from '../social-integrations/sync/insights-window';
import { GA4_LOCAL_START_HOUR, isGa4SyncEnabled } from './ga4-sync.config';
import { Ga4PropertyDirectoryService } from './ga4-property-directory.service';
import { Ga4SyncService } from './ga4-sync.service';

/**
 * Once an hour, runs the daily read for every selected property whose own
 * morning has arrived and whose yesterday is still unread (D-G8, §8.3).
 *
 * The hourly tick (instead of one 04:00 job) is what makes properties in other
 * time zones and a missed hour harmless: the same question is asked every hour
 * and answered in the property's zone. Sequential on purpose — quota is per
 * property and the project is small; no fan-out.
 */
@Injectable()
export class Ga4SyncScheduler {
  private readonly logger = new Logger(Ga4SyncScheduler.name);
  private running = false;

  constructor(
    private readonly directory: Ga4PropertyDirectoryService,
    private readonly sync: Ga4SyncService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick(now: Date = new Date()): Promise<number> {
    if (!isGa4SyncEnabled() || this.running) return 0;
    this.running = true;
    let started = 0;
    try {
      for (const entry of await this.directory.listAll()) {
        for (const property of entry.properties) {
          // Never assume UTC for a property whose zone is unknown (B-05).
          if (!property.timeZone) continue;
          if (currentHourIn(property.timeZone, now) < GA4_LOCAL_START_HOUR) {
            continue;
          }
          try {
            if (
              await this.sync.hasFinishedRunFor(
                entry.scope,
                property.propertyId,
                property.timeZone,
                now,
              )
            ) {
              continue;
            }
            started += 1;
            await this.sync.syncProperty({
              scope: entry.scope,
              propertyId: property.propertyId,
              trigger: 'scheduled',
              now,
            });
          } catch (error) {
            // One property must not stop the others; only the class is logged.
            this.logger.warn(
              `ga4 scheduled sync skipped: ${error instanceof Error ? error.name : 'error'}`,
            );
          }
        }
      }
    } finally {
      this.running = false;
    }
    return started;
  }
}
