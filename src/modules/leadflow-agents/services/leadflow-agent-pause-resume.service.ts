import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import { LeadFlowAgentEntity } from '../entities';
import { LeadFlowAgentStatus } from '../enums/leadflow-agent-status.enum';
import { LeadFlowAgentService } from './leadflow-agent.service';

const AGENCY_CONNECTION = 'agency';
const LOCK_KEY = 'leadflow-agent-pause-resume';
const BATCH = 50;
export const LEADFLOW_AGENT_PAUSE_ENDED_EVENT = 'leadflow.agent.pause_ended';

/**
 * OR5 — brings back the agents whose timed pause (`paused_until`) passed.
 *
 * Once a minute, under a cluster-wide advisory lock (one instance sweeps at a
 * time). Each agent is resumed by `LeadFlowAgentService.resumeExpiredPause`,
 * in its own persisted context, which re-checks the row: an agent paused
 * again without a date, activated by hand or archived meanwhile is left
 * alone, so a repeated sweep never acts twice. The resume publishes the
 * room event `agent_pause_expired` and notifies who scheduled the pause.
 */
@Injectable()
export class LeadFlowAgentPauseResumeService implements OnApplicationShutdown {
  private readonly logger = new Logger(LeadFlowAgentPauseResumeService.name);
  private running = false;
  private stopping = false;

  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    @InjectRepository(LeadFlowAgentEntity, AGENCY_CONNECTION)
    private readonly agentsRepository: Repository<LeadFlowAgentEntity>,
    private readonly agents: LeadFlowAgentService,
    private readonly notifications: NotificationEventProcessorService,
  ) {}

  onApplicationShutdown(): void {
    this.stopping = true;
  }

  @Interval(60_000)
  async tick(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    const runner = this.dataSource.createQueryRunner();
    try {
      await runner.connect();
      const rows = (await runner.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [LOCK_KEY],
      )) as Array<{ locked: boolean }>;
      if (!rows[0]?.locked) return;
      try {
        await this.resumeDue();
      } finally {
        await runner.query(
          'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
          [LOCK_KEY],
        );
      }
    } catch (error) {
      this.logger.warn(`Pause resume sweep failed: ${errorCode(error)}`);
    } finally {
      await runner.release();
      this.running = false;
    }
  }

  /** One sweep; returns how many agents were resumed. */
  async resumeDue(now = new Date()): Promise<number> {
    const due = await this.agentsRepository.find({
      select: {
        id: true,
        tenantId: true,
        workspaceId: true,
        agencyClientId: true,
        companyContextId: true,
      },
      where: {
        status: LeadFlowAgentStatus.Paused,
        pausedUntil: LessThanOrEqual(now),
        deletedAt: IsNull(),
      },
      order: { pausedUntil: 'ASC' },
      take: BATCH,
    });
    let resumed = 0;
    for (const row of due) {
      try {
        const agent = await this.agents.resumeExpiredPause(row, now);
        if (!agent) continue;
        resumed += 1;
        await this.notify(agent);
      } catch (error) {
        this.logger.warn(
          `Pause resume failed agent=${row.id} error=${errorCode(error)}`,
        );
      }
    }
    return resumed;
  }

  /** Best effort: the resume already happened and is in the room history. */
  private async notify(agent: LeadFlowAgentEntity): Promise<void> {
    // `updatedById` is who confirmed the timed pause (set by the pause).
    if (!agent.updatedById) return;
    try {
      await this.notifications.process({
        eventId: `${LEADFLOW_AGENT_PAUSE_ENDED_EVENT}:${agent.id}:${agent.pausedUntil?.toISOString() ?? ''}`,
        eventType: LEADFLOW_AGENT_PAUSE_ENDED_EVENT,
        tenantId: agent.tenantId,
        workspaceId: agent.workspaceId,
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'sales',
        actorType: NotificationActorType.SYSTEM,
        actorUserId: null,
        resourceType: 'leadflow_agent',
        resourceId: agent.id,
        occurredAt: new Date().toISOString(),
        recipients: [
          {
            userId: agent.updatedById,
            interestReason: NotificationInterestReason.REQUESTER,
          },
        ],
        payload: {
          title: 'Agente de volta ao atendimento',
          body: `${agent.name} voltou a atender depois da pausa programada.`,
          actionUrl: `/leadflow/agents/${agent.id}`,
          resourceId: agent.id,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Pause resume notification failed agent=${agent.id} error=${errorCode(error)}`,
      );
    }
  }
}

function errorCode(error: unknown): string {
  return (error as Error)?.constructor?.name ?? 'unknown';
}
