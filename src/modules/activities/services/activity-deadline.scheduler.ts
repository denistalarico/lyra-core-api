import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Not, Repository } from 'typeorm';
import { AgencyActivity, AgencyActivityLink } from '../entities';
import { ActivityStatus } from '../enums';
import { ActivityNotificationPublisher } from './activity-notification.publisher';

const OVERDUE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const DUE_SOON_AHEAD_MS = 24 * 60 * 60 * 1000;

const INACTIVE_ACTIVITY_STATUSES = [
  ActivityStatus.Done,
  ActivityStatus.Cancelled,
  ActivityStatus.Archived,
];

/**
 * Varre periodicamente atividades com prazo (dueAt) próximo ou vencido e
 * publica os eventos de notificação. A idempotência é garantida pelo
 * processador de eventos (dedup por sourceEventId).
 */
@Injectable()
export class ActivityDeadlineScheduler {
  private readonly logger = new Logger(ActivityDeadlineScheduler.name);

  constructor(
    @InjectRepository(AgencyActivity, 'agency')
    private readonly activitiesRepo: Repository<AgencyActivity>,
    @InjectRepository(AgencyActivityLink, 'agency')
    private readonly linksRepo: Repository<AgencyActivityLink>,
    private readonly publisher: ActivityNotificationPublisher,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async scanDeadlines() {
    const now = new Date();
    const windowStart = new Date(now.getTime() - OVERDUE_LOOKBACK_MS);
    const windowEnd = new Date(now.getTime() + DUE_SOON_AHEAD_MS);

    let activities: AgencyActivity[];

    try {
      activities = await this.activitiesRepo.find({
        where: {
          dueAt: Between(windowStart, windowEnd),
          status: Not(In(INACTIVE_ACTIVITY_STATUSES)),
          completedAt: IsNull(),
          cancelledAt: IsNull(),
          assignedToId: Not(IsNull()),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to scan activity deadlines: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    for (const activity of activities) {
      if (!activity.dueAt) {
        continue;
      }

      const links = await this.linksRepo.find({
        where: {
          tenantId: activity.tenantId,
          workspaceId: activity.workspaceId,
          activityId: activity.id,
        },
      });

      if (activity.dueAt.getTime() < now.getTime()) {
        await this.publisher.publishOverdue({ activity, links });
      } else {
        await this.publisher.publishDueSoon({ activity, links });
      }
    }
  }
}
