import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager, In, IsNull } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import {
  AgencyUserProfileEntity,
  AgencyWorkspaceUserEntity,
} from '../agency/entities/agency-settings.entities';
import { AgencyChatChannel } from '../team-chat/entities/agency-chat-channel.entity';
import { approvalScopeWhere } from './approval-scope';
import { approvalScopeKind } from './approval-stage.policy';
import type { UpdateSocialApprovalSettingsDto } from './dto/social-approval-piece.dto';
import { SocialApprovalSettingsEntity } from './entities';
import { SocialApprovalAuthorityService } from './social-approval-authority.service';

export type EffectiveSocialApprovalSettings = {
  scopeKind: 'own' | 'managed_client';
  internalApprovalEnabled: boolean;
  internalApproverUserIds: string[];
  clientApproverMembershipIds: string[];
  clientDecisionPolicy: 'first' | 'all';
  clientCanEditText: boolean;
  sendToConversation: boolean;
  registerDecisionsInConversation: boolean;
  teamChatChannelId: string | null;
  notificationEvents: Record<string, unknown>;
};

const MAX_NOTIFICATION_EVENT_KEYS = 40;

/** One-level object of booleans, or of `{ audience: boolean }` maps. */
function assertNotificationEvents(value: Record<string, unknown>) {
  const isBooleanMap = (input: unknown) =>
    typeof input === 'object' &&
    input !== null &&
    !Array.isArray(input) &&
    Object.values(input).every((item) => typeof item === 'boolean');
  const entries = Object.entries(value);
  if (
    entries.length > MAX_NOTIFICATION_EVENT_KEYS ||
    !entries.every(
      ([, item]) => typeof item === 'boolean' || isBooleanMap(item),
    )
  )
    throw new BadRequestException('Configuração de notificações inválida.');
}

/** D-18: one row per context, safe defaults when there is none. */
@Injectable()
export class SocialApprovalSettingsService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly authority: SocialApprovalAuthorityService,
  ) {}

  async get(
    scope: CompanyAwareScope,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<EffectiveSocialApprovalSettings> {
    const row = await manager
      .getRepository(SocialApprovalSettingsEntity)
      .findOne({ where: approvalScopeWhere(scope) });
    const scopeKind = approvalScopeKind(scope);
    return {
      scopeKind,
      // D-14: the internal stage is the final decision in the own scope.
      internalApprovalEnabled:
        scopeKind === 'own' ? true : (row?.internalApprovalEnabled ?? true),
      internalApproverUserIds: row?.internalApproverUserIds ?? [],
      clientApproverMembershipIds: row?.clientApproverMembershipIds ?? [],
      clientDecisionPolicy: row?.clientDecisionPolicy ?? 'first',
      clientCanEditText: row?.clientCanEditText ?? false,
      sendToConversation: row?.sendToConversation ?? true,
      registerDecisionsInConversation:
        row?.registerDecisionsInConversation ?? true,
      teamChatChannelId: row?.teamChatChannelId ?? null,
      notificationEvents: row?.notificationEvents ?? {},
    };
  }

  /** D-17: who hears about an internal review. Empty list means the Owners. */
  async internalApproverRecipients(
    scope: CompanyAwareScope,
    settings: Pick<EffectiveSocialApprovalSettings, 'internalApproverUserIds'>,
  ): Promise<string[]> {
    if (settings.internalApproverUserIds.length)
      return settings.internalApproverUserIds;
    const owners = await this.dataSource
      .getRepository(AgencyWorkspaceUserEntity)
      .find({
        where: {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          status: 'active',
          role: 'owner',
        },
      });
    return owners
      .map((owner) => owner.userId)
      .filter((userId): userId is string => Boolean(userId));
  }

  async update(
    scope: CompanyAwareScope,
    actorUserId: string,
    input: UpdateSocialApprovalSettingsDto,
  ): Promise<EffectiveSocialApprovalSettings> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `social-approval-settings:${scope.tenantId}:${scope.workspaceId}:${scope.agencyClientId}:${scope.companyContextId}`,
      ]);
      await this.validate(manager, scope, input);
      const repository = manager.getRepository(SocialApprovalSettingsEntity);
      const row =
        (await repository.findOne({ where: approvalScopeWhere(scope) })) ??
        repository.create({
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          companyContextId: scope.companyContextId,
        });
      for (const key of [
        'internalApprovalEnabled',
        'internalApproverUserIds',
        'clientApproverMembershipIds',
        'clientDecisionPolicy',
        'clientCanEditText',
        'sendToConversation',
        'registerDecisionsInConversation',
        'teamChatChannelId',
        'notificationEvents',
      ] as const) {
        if (input[key] !== undefined) Object.assign(row, { [key]: input[key] });
      }
      row.updatedByUserId = actorUserId;
      await repository.save(row);
      return this.get(scope, manager);
    });
  }

  private async validate(
    manager: EntityManager,
    scope: CompanyAwareScope,
    input: UpdateSocialApprovalSettingsDto,
  ) {
    const own = approvalScopeKind(scope) === 'own';
    if (own && input.internalApprovalEnabled === false)
      throw new BadRequestException(
        'A aprovação interna é obrigatória no escopo próprio.',
      );
    if (own && input.clientApproverMembershipIds?.length)
      throw new BadRequestException(
        'O escopo próprio não tem responsáveis do cliente.',
      );
    if (input.notificationEvents)
      assertNotificationEvents(input.notificationEvents);

    const internal = [...new Set(input.internalApproverUserIds ?? [])];
    if (internal.length) {
      const known = await manager.getRepository(AgencyUserProfileEntity).count({
        where: { tenantId: scope.tenantId, userId: In(internal) },
      });
      if (known !== internal.length)
        throw new BadRequestException(
          'Há responsável interno que não pertence a esta agência.',
        );
    }

    const clientIds = [...new Set(input.clientApproverMembershipIds ?? [])];
    if (clientIds.length) {
      const eligible = await this.authority.eligibleClientApprovers(
        manager,
        scope,
        clientIds,
      );
      if (eligible.length !== clientIds.length)
        throw new BadRequestException(
          'Há responsável do cliente sem acesso ativo ou sem permissão para decidir.',
        );
    }

    if (input.teamChatChannelId) {
      const channel = await manager.getRepository(AgencyChatChannel).findOne({
        where: {
          id: input.teamChatChannelId,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          archivedAt: IsNull(),
        },
      });
      if (!channel)
        throw new BadRequestException('Canal do Team Chat não encontrado.');
    }
  }
}
