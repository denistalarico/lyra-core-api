import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual } from 'typeorm';
import { LeadFlowTelemetryConsentEntity } from '../../leadflow-privacy/entities/leadflow-telemetry-consent.entity';
import { LeadFlowTelemetryConsentNoticeEntity } from '../../leadflow-privacy/entities/leadflow-telemetry-consent-notice.entity';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { ClientAreaMembershipEntity } from '../entities/client-area-membership.entity';
import type {
  ClientAreaContext,
  ClientAreaConsentState,
} from '../client-area.types';
import { AuditChangeService, recordChange } from './audit-change.service';
import { toCompanyAwareScope } from '../client-area-scope';

export const CLIENT_AREA_ESSENTIAL_PURPOSE = 'client_area_essential_processing';
export const CLIENT_AREA_CONSENT_PURPOSES = [
  CLIENT_AREA_ESSENTIAL_PURPOSE,
  'platform_product_improvement_v1',
  'leadflow_product_improvement_v1',
] as const;
type ConsentScope = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string;
  companyContextId: string;
};
export type ClientAreaConsentDecision = {
  purposeKey: string;
  decision: 'accept' | 'decline' | 'revoke';
  noticeId: string;
  contentHash: string;
};

@Injectable()
export class ClientAreaConsentService {
  constructor(
    @InjectDataSource('agency') private readonly db: DataSource,
    private readonly audit: AuditChangeService,
  ) {}
  async currentNotice(
    purposeKey: string,
    manager = this.db.manager,
    now = new Date(),
  ) {
    return manager.getRepository(LeadFlowTelemetryConsentNoticeEntity).findOne({
      where: {
        purposeKey,
        status: 'active',
        locale: 'pt-BR',
        effectiveAt: LessThanOrEqual(now),
      },
      order: { version: 'DESC' },
    });
  }
  private latest(
    scope: ConsentScope,
    purposeKey: string,
    manager = this.db.manager,
  ) {
    return manager.getRepository(LeadFlowTelemetryConsentEntity).findOne({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        purposeKey,
        contextType: LeadFlowSettingsContextType.Client,
      },
      order: { occurredAt: 'DESC', createdAt: 'DESC', id: 'DESC' },
    });
  }
  async state(
    scope: ConsentScope,
    ownerDecides = false,
    manager = this.db.manager,
  ): Promise<ClientAreaConsentState> {
    const [notice, consent] = await Promise.all([
      this.currentNotice(CLIENT_AREA_ESSENTIAL_PURPOSE, manager),
      this.latest(scope, CLIENT_AREA_ESSENTIAL_PURPOSE, manager),
    ]);
    const cleared = notice?.legalReviewStatus === 'approved';
    const accepted =
      cleared &&
      consent?.status === 'opted_in' &&
      consent.noticeId === notice.id &&
      consent.noticeVersion === notice.version &&
      consent.noticeContentHash === notice.contentHash;
    return {
      status:
        !notice || !cleared
          ? 'notice_unavailable'
          : accepted
            ? 'accepted'
            : consent?.status === 'opted_out'
              ? 'revoked'
              : 'required',
      noticeVersion: notice?.version ?? null,
      ownerDecides,
    };
  }
  async get(context: ClientAreaContext) {
    const scope = toCompanyAwareScope(context);
    const notices = await Promise.all(
      CLIENT_AREA_CONSENT_PURPOSES.map(async (purposeKey) => {
        const [notice, current] = await Promise.all([
          this.currentNotice(purposeKey),
          this.latest(scope, purposeKey),
        ]);
        return {
          purposeKey,
          essential: purposeKey === CLIENT_AREA_ESSENTIAL_PURPOSE,
          notice: notice
            ? {
                id: notice.id,
                version: notice.version,
                title: notice.title,
                body: notice.body,
                contentHash: notice.contentHash,
                legalReviewStatus: notice.legalReviewStatus,
              }
            : null,
          status: current?.status ?? 'not_configured',
          noticeVersion: current?.noticeVersion ?? null,
        };
      }),
    );
    return {
      consent: await this.state(scope, context.role === 'client_owner'),
      purposes: notices,
    };
  }
  async history(context: ClientAreaContext, page: number, limit: number) {
    const scope = toCompanyAwareScope(context);
    const [rows, total] = await this.db
      .getRepository(LeadFlowTelemetryConsentEntity)
      .findAndCount({
        where: { ...scope, contextType: LeadFlowSettingsContextType.Client },
        order: { occurredAt: 'DESC', id: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      });
    return {
      events: rows.map((row) => ({
        id: row.id,
        purposeKey: row.purposeKey,
        status: row.status,
        actorUserId: row.actorUserId,
        actorSurface: row.actorSurface,
        noticeVersion: row.noticeVersion,
        occurredAt: row.occurredAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }

  async decide(context: ClientAreaContext, input: ClientAreaConsentDecision) {
    if (context.role !== 'client_owner')
      throw new ForbiddenException('Only the Owner can decide consent.');
    if (
      !(CLIENT_AREA_CONSENT_PURPOSES as readonly string[]).includes(
        input.purposeKey,
      )
    )
      throw new BadRequestException('Unknown consent purpose.');
    if (
      input.purposeKey === CLIENT_AREA_ESSENTIAL_PURPOSE &&
      input.decision === 'decline'
    )
      throw new BadRequestException('Essential processing cannot be declined.');
    const scope = toCompanyAwareScope(context);
    const change = await this.db.transaction(async (manager) => {
      // Same company advisory lock as access changes: recheck current ownership under the lock.
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `client_area_access:${scope.companyContextId}`,
      ]);
      const owner = await manager
        .getRepository(ClientAreaMembershipEntity)
        .findOne({
          where: {
            id: context.membershipId,
            ...scope,
            userId: context.userId,
            status: 'active',
            role: 'client_owner',
          },
          lock: { mode: 'pessimistic_read' },
        });
      if (!owner)
        throw new ForbiddenException(
          'Only the current Owner can decide consent.',
        );
      const notice = await this.currentNotice(input.purposeKey, manager);
      if (
        !notice ||
        notice.id !== input.noticeId ||
        notice.contentHash !== input.contentHash
      )
        throw new ConflictException({
          code: 'client_area_consent_notice_changed',
          message: 'Read the current notice before deciding.',
        });
      if (
        input.decision === 'accept' &&
        notice.legalReviewStatus !== 'approved'
      )
        throw new ConflictException({
          code: 'client_area_consent_legal_review_pending',
          message: 'The notice is pending legal review.',
        });
      const before = await this.latest(scope, input.purposeKey, manager);
      const status = input.decision === 'accept' ? 'opted_in' : 'opted_out';
      if (input.decision === 'revoke' && !before)
        throw new BadRequestException('There is no consent to revoke.');
      if (
        before?.status === status &&
        before.noticeId === notice.id &&
        before.noticeContentHash === notice.contentHash
      )
        return null;
      await manager.getRepository(LeadFlowTelemetryConsentEntity).insert({
        ...scope,
        contextType: LeadFlowSettingsContextType.Client,
        noticeId: notice.id,
        purposeKey: input.purposeKey,
        status,
        actorUserId: context.userId,
        actorSurface: 'client_area',
        reasonCode: input.decision === 'revoke' ? 'owner_revoked' : null,
        noticeVersion: notice.version,
        noticeContentHash: notice.contentHash,
        occurredAt: new Date(),
      });
      return recordChange(
        {
          status: before?.status ?? null,
          noticeVersion: before?.noticeVersion ?? null,
        },
        { status, noticeVersion: notice.version },
        ['status', 'noticeVersion'],
      );
    });
    if (change)
      await this.audit.record({
        ...scope,
        actorSurface: 'client_area',
        actorUserId: context.userId,
        moduleKey: 'settings',
        entityType: 'consent',
        action: 'state_change',
        ...change,
      });
    return this.get(context);
  }
}
