import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { CalendarEvent } from './entities/calendar-event.entity';
import type {
  CalendarDashboardEvent,
  CalendarDashboardSummary,
} from './types';

type CalendarDashboardContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

@Injectable()
export class CalendarDashboardQueryService {
  constructor(
    @InjectRepository(CalendarEvent, 'agency')
    private readonly eventsRepository: Repository<CalendarEvent>,
  ) {}

  async getSummary(
    context: CalendarDashboardContext,
  ): Promise<CalendarDashboardSummary> {
    const now = new Date();
    const todayStart = this.startOfUtcDay(now);
    const todayEnd = this.endOfUtcDay(now);
    const rangeEnd = this.endOfUtcDay(this.addDays(now, 7));

    const events = await this.eventsRepository
      .createQueryBuilder('event')
      .where('event.tenant_id = :tenantId', {
        tenantId: context.tenantId,
      })
      .andWhere('event.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
      .andWhere('event.deleted_at IS NULL')
      .andWhere('event.status != :cancelledStatus', {
        cancelledStatus: 'canceled',
      })
      .andWhere('event.starts_at <= :rangeEnd', {
        rangeEnd,
      })
      .andWhere('event.ends_at >= :todayStart', {
        todayStart,
      })
      .andWhere(
        new Brackets((visibilityQb) => {
          visibilityQb
            .where('event.visibility IN (:...sharedVisibilities)', {
              sharedVisibilities: ['workspace', 'team'],
            })
            .orWhere(
              new Brackets((privateQb) => {
                privateQb
                  .where('event.visibility = :privateVisibility', {
                    privateVisibility: 'private',
                  })
                  .andWhere(
                    new Brackets((ownerQb) => {
                      ownerQb
                        .where('event.owner_user_id = :userId', {
                          userId: context.userId,
                        })
                        .orWhere('event.created_by_user_id = :userId', {
                          userId: context.userId,
                        });
                    }),
                  );
              }),
            );
        }),
      )
      .orderBy('event.starts_at', 'ASC')
      .getMany();

    const todayEvents = events.filter(
      (event) =>
        event.startsAt.getTime() <= todayEnd.getTime() &&
        event.endsAt.getTime() >= todayStart.getTime(),
    );

    const upcomingEvents = events
      .filter(
        (event) =>
          event.endsAt.getTime() >= now.getTime() &&
          event.startsAt.getTime() <= rangeEnd.getTime(),
      )
      .slice(0, 8);

    const nextEvent =
      upcomingEvents.find(
        (event) => event.endsAt.getTime() >= now.getTime(),
      ) ?? null;

    return {
      generatedAt: now.toISOString(),
      range: {
        start: todayStart.toISOString(),
        end: rangeEnd.toISOString(),
      },
      today: {
        total: todayEvents.length,
        remaining: todayEvents.filter(
          (event) => event.endsAt.getTime() >= now.getTime(),
        ).length,
        allDay: todayEvents.filter((event) => event.allDay).length,
      },
      nextSevenDays: events.filter(
        (event) =>
          event.startsAt.getTime() <= rangeEnd.getTime() &&
          event.endsAt.getTime() >= todayStart.getTime(),
      ).length,
      nextEvent: nextEvent
        ? this.mapEvent(nextEvent)
        : null,
      upcomingEvents: upcomingEvents.map((event) =>
        this.mapEvent(event),
      ),
    };
  }

  private mapEvent(
    event: CalendarEvent,
  ): CalendarDashboardEvent {
    return {
      id: event.id,
      title: event.title,
      eventType: event.eventType,
      status: event.status,
      visibility: event.visibility,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      allDay: event.allDay,
      ownerUserId: event.ownerUserId,
      clientId: event.clientId,
      projectId: event.projectId,
      taskId: event.taskId,
      salesOpportunityId: event.salesOpportunityId,
      href: '/calendar',
    };
  }

  private startOfUtcDay(value: Date) {
    return new Date(
      Date.UTC(
        value.getUTCFullYear(),
        value.getUTCMonth(),
        value.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );
  }

  private endOfUtcDay(value: Date) {
    return new Date(
      Date.UTC(
        value.getUTCFullYear(),
        value.getUTCMonth(),
        value.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );
  }

  private addDays(value: Date, days: number) {
    const date = new Date(value);
    date.setUTCDate(date.getUTCDate() + days);
    return date;
  }
}
