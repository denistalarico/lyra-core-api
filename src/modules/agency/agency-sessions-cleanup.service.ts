import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import {
  AgencyUserLoginEventEntity,
  AgencyUserSessionEntity,
  AgencyUserTrustedDeviceEntity,
} from './entities/agency-auth.entities';

const AGENCY_CONNECTION = 'agency';
const RETENTION_DAYS = 30;

@Injectable()
export class AgencySessionsCleanupService {
  private readonly logger = new Logger(AgencySessionsCleanupService.name);

  constructor(
    @InjectRepository(AgencyUserSessionEntity, AGENCY_CONNECTION)
    private readonly sessionsRepo: Repository<AgencyUserSessionEntity>,
    @InjectRepository(AgencyUserTrustedDeviceEntity, AGENCY_CONNECTION)
    private readonly trustedDevicesRepo: Repository<AgencyUserTrustedDeviceEntity>,
    @InjectRepository(AgencyUserLoginEventEntity, AGENCY_CONNECTION)
    private readonly loginEventsRepo: Repository<AgencyUserLoginEventEntity>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCleanup() {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const [sessions, devices, events] = await Promise.all([
      this.sessionsRepo.delete({
        status: 'expired',
        revokedAt: LessThan(cutoff),
      }),
      this.trustedDevicesRepo.delete({
        revokedAt: LessThan(cutoff),
      }),
      this.loginEventsRepo.delete({
        createdAt: LessThan(cutoff),
      }),
    ]);

    this.logger.log(
      `Cleanup removed ${sessions.affected ?? 0} expired sessions, ${devices.affected ?? 0} revoked devices, ${events.affected ?? 0} old login events older than ${RETENTION_DAYS}d.`,
    );
  }
}
