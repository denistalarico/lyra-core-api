import type {
  CalendarEventStatus,
  CalendarEventType,
  CalendarEventVisibility,
} from '../entities/calendar-event.entity';

export type CalendarDashboardEvent = {
  id: string;
  title: string;
  eventType: CalendarEventType;
  status: CalendarEventStatus;
  visibility: CalendarEventVisibility;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  ownerUserId: string | null;
  clientId: string | null;
  projectId: string | null;
  taskId: string | null;
  salesOpportunityId: string | null;
  href: string;
};

export type CalendarDashboardSummary = {
  generatedAt: string;
  range: {
    start: string;
    end: string;
  };
  today: {
    total: number;
    remaining: number;
    allDay: number;
  };
  nextSevenDays: number;
  nextEvent: CalendarDashboardEvent | null;
  upcomingEvents: CalendarDashboardEvent[];
};
