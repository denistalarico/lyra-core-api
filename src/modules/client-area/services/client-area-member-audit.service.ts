import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type {
  ClientAreaMemberEventAction,
  ClientAreaRole,
} from '../client-area.types';
import {
  ClientAreaMemberEventEntity,
  type ClientAreaMemberEventActorSurface,
} from '../entities/client-area-member-event.entity';

export type ClientAreaCompanyTuple = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string;
  companyContextId: string;
};

export type ClientAreaMemberEventInput = {
  company: ClientAreaCompanyTuple;
  action: ClientAreaMemberEventAction;
  actorSurface: ClientAreaMemberEventActorSurface;
  actorUserId: string | null;
  invitationId?: string | null;
  membershipId?: string | null;
  targetUserId?: string | null;
  targetEmail?: string | null;
  previousRole?: ClientAreaRole | null;
  newRole?: ClientAreaRole | null;
  metadata?: Record<string, unknown>;
};

/**
 * CA2 — writes `client_area_member_events`. Always inside the caller's
 * transaction, so an operation and its audit row commit or roll back
 * together; application logs are never the only record.
 */
@Injectable()
export class ClientAreaMemberAuditService {
  async record(
    manager: EntityManager,
    event: ClientAreaMemberEventInput,
  ): Promise<void> {
    const repo = manager.getRepository(ClientAreaMemberEventEntity);

    await repo.insert({
      tenantId: event.company.tenantId,
      workspaceId: event.company.workspaceId,
      agencyClientId: event.company.agencyClientId,
      companyContextId: event.company.companyContextId,
      action: event.action,
      actorSurface: event.actorSurface,
      actorUserId: event.actorUserId,
      invitationId: event.invitationId ?? null,
      membershipId: event.membershipId ?? null,
      targetUserId: event.targetUserId ?? null,
      targetEmail: event.targetEmail ?? null,
      previousRole: event.previousRole ?? null,
      newRole: event.newRole ?? null,
      metadata: (event.metadata ?? {}) as never,
    });
  }
}
