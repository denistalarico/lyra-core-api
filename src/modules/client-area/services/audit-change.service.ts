import { randomUUID } from 'node:crypto';
import { AgencyClient } from '../../clients/entities/agency-client.entity';
import { AgencyClientCompanyContext } from '../../clients/entities/agency-client-company-context.entity';
import { isUuid } from '../client-area.types';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditChangeEventEntity } from '../entities/audit-change-event.entity';

export type AuditChangeInput = Pick<
  AuditChangeEventEntity,
  'tenantId' | 'actorSurface' | 'moduleKey' | 'entityType' | 'action'
> &
  Partial<AuditChangeEventEntity>;
/** Only service-declared allowlists may supply values. Generic HTTP capture records names, never body values. */
export function recordChange(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  allowlist: readonly string[],
) {
  const changedFields = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  const diff: AuditChangeEventEntity['diff'] = {};
  for (const key of allowlist)
    if (changedFields.includes(key))
      diff[key] = { before: before[key] ?? null, after: after[key] ?? null };
  return { changedFields, diff };
}

@Injectable()
export class AuditChangeService {
  private readonly logger = new Logger(AuditChangeService.name);
  private failures = 0;
  private purging = false;
  get failedWrites() {
    return this.failures;
  }
  constructor(
    @InjectRepository(AuditChangeEventEntity, 'agency')
    private readonly repo: Repository<AuditChangeEventEntity>,
    private readonly config: ConfigService,
  ) {}
  async record(input: AuditChangeInput): Promise<void> {
    const requestId = input.requestId ?? randomUUID();
    try {
      await this.repo.insert({
        workspaceId: null,
        agencyClientId: null,
        companyContextId: null,
        actorUserId: null,
        entityId: null,
        ip: null,
        userAgent: null,
        internal: false,
        changedFields: [],
        diff: {},
        ...input,
        requestId,
      } as never);
    } catch {
      this.failures++;
      this.logger.error({
        message: 'audit_change_write_failed',
        requestId,
        failedWrites: this.failures,
      });
    }
  }
  async list(
    scope: { tenantId: string; workspaceId: string; agencyClientId: string },
    filters: {
      companyContextId?: string;
      moduleKey?: string;
      actorSurface?: string;
      actorUserId?: string;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    },
    clientVisibleOnly = false,
  ) {
    if (
      !isUuid(scope.agencyClientId) ||
      !(await this.repo.manager.getRepository(AgencyClient).exists({
        where: {
          id: scope.agencyClientId,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
        },
      }))
    )
      throw new NotFoundException('Client is not available.');
    if (
      filters.companyContextId &&
      !(await this.repo.manager
        .getRepository(AgencyClientCompanyContext)
        .exists({
          where: {
            id: filters.companyContextId,
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
            agencyClientId: scope.agencyClientId,
          },
        }))
    )
      throw new NotFoundException('Company is not available.');
    const page = filters.page ?? 1,
      limit = filters.limit ?? 50;
    const query = this.repo
      .createQueryBuilder('e')
      .where(
        'e.tenant_id=:tenantId AND e.workspace_id=:workspaceId AND e.agency_client_id=:agencyClientId',
        scope,
      );
    if (clientVisibleOnly) query.andWhere('e.internal = false');
    for (const [key, column] of Object.entries({
      companyContextId: 'company_context_id',
      moduleKey: 'module_key',
      actorSurface: 'actor_surface',
      actorUserId: 'actor_user_id',
    })) {
      const value = filters[key as keyof typeof filters];
      if (value) query.andWhere(`e.${column}=:${key}`, { [key]: value });
    }
    if (filters.from)
      query.andWhere('e.occurred_at>=:from', { from: filters.from });
    if (filters.to) query.andWhere('e.occurred_at<=:to', { to: filters.to });
    const [events, total] = await query
      .orderBy('e.occurred_at', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return {
      events: events.map((e) => ({
        id: e.id,
        companyContextId: e.companyContextId,
        actorUserId: e.actorUserId,
        actorSurface: e.actorSurface,
        moduleKey: e.moduleKey,
        entityType: e.entityType,
        entityId: e.entityId,
        action: e.action,
        changedFields: e.changedFields,
        diff: e.diff,
        internal: e.internal,
        occurredAt: e.occurredAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }
  @Cron('0 3 * * *')
  async purge(): Promise<void> {
    if (this.purging) return;
    const months = Number(
      this.config.get<string>('AUDIT_CHANGE_RETENTION_MONTHS') ?? 12,
    );
    if (!Number.isInteger(months) || months < 1 || months > 120) {
      this.logger.error('Invalid AUDIT_CHANGE_RETENTION_MONTHS');
      return;
    }
    this.purging = true;
    try {
      await this.repo.query('SELECT audit_change_purge($1)', [months]);
    } catch {
      this.logger.error('audit_change_purge_failed');
    } finally {
      this.purging = false;
    }
  }
}
