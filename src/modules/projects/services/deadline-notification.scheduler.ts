import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Not, Repository } from 'typeorm';
import { AgencyProject, AgencyTask } from '../entities';
import { ProjectStatus, TaskStatus } from '../enums';
import { ProjectNotificationPublisher } from './project-notification.publisher';
import { TaskNotificationPublisher } from './task-notification.publisher';

const OVERDUE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const DUE_SOON_AHEAD_MS = 24 * 60 * 60 * 1000;

const INACTIVE_TASK_STATUSES = [
  TaskStatus.Done,
  TaskStatus.Cancelled,
  TaskStatus.Archived,
];

const INACTIVE_PROJECT_STATUSES = [
  ProjectStatus.Draft,
  ProjectStatus.Completed,
  ProjectStatus.Cancelled,
  ProjectStatus.Archived,
];

/**
 * Varre periodicamente tarefas e projetos com prazo próximo ou vencido e
 * publica os eventos de notificação correspondentes. A idempotência é
 * garantida pelo processador de eventos (dedup por sourceEventId), portanto
 * cada tarefa/projeto gera no máximo uma notificação por fase (due_soon /
 * overdue) para um mesmo prazo.
 */
@Injectable()
export class DeadlineNotificationScheduler {
  private readonly logger = new Logger(DeadlineNotificationScheduler.name);

  constructor(
    @InjectRepository(AgencyTask, 'agency')
    private readonly tasksRepo: Repository<AgencyTask>,
    @InjectRepository(AgencyProject, 'agency')
    private readonly projectsRepo: Repository<AgencyProject>,
    private readonly taskPublisher: TaskNotificationPublisher,
    private readonly projectPublisher: ProjectNotificationPublisher,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async scanDeadlines() {
    const now = new Date();

    try {
      await this.scanTasks(now);
    } catch (error) {
      this.logger.warn(
        `Failed to scan task deadlines: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    try {
      await this.scanProjects(now);
    } catch (error) {
      this.logger.warn(
        `Failed to scan project deadlines: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async scanTasks(now: Date) {
    const windowStart = new Date(now.getTime() - OVERDUE_LOOKBACK_MS);
    const windowEnd = new Date(now.getTime() + DUE_SOON_AHEAD_MS);

    const tasks = await this.tasksRepo.find({
      where: {
        dueDate: Between(windowStart, windowEnd),
        status: Not(In(INACTIVE_TASK_STATUSES)),
        archivedAt: IsNull(),
        completedAt: IsNull(),
        assigneeId: Not(IsNull()),
      },
    });

    for (const task of tasks) {
      if (!task.dueDate) {
        continue;
      }

      if (task.dueDate.getTime() < now.getTime()) {
        await this.taskPublisher.publishOverdue({ task });
      } else {
        await this.taskPublisher.publishDueSoon({ task });
      }
    }
  }

  private async scanProjects(now: Date) {
    const windowStart = new Date(now.getTime() - OVERDUE_LOOKBACK_MS);
    const windowEnd = new Date(now.getTime() + DUE_SOON_AHEAD_MS);

    const projects = await this.projectsRepo.find({
      where: {
        dueDate: Between(windowStart, windowEnd),
        status: Not(In(INACTIVE_PROJECT_STATUSES)),
        archivedAt: IsNull(),
        completedAt: IsNull(),
        ownerId: Not(IsNull()),
      },
    });

    for (const project of projects) {
      if (!project.dueDate) {
        continue;
      }

      const phase =
        project.dueDate.getTime() < now.getTime() ? 'overdue' : 'due_soon';

      await this.projectPublisher.publishDeadlineAtRisk({ project, phase });
    }
  }
}
