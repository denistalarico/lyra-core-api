import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, type DataSourceOptions } from 'typeorm';
import type { CompanyAwareScope } from '../../../common/context/company-aware-scope';
import { MediaAssetEntity } from '../../../common/media-assets/media-asset.entity';
import { getAgencyTypeOrmConfig } from '../../../config/typeorm.config';
import { CreateSocialApprovals1795100000000 } from '../../../database/migrations/1795100000000-create-social-approvals';
import { AddSocialApprovalViewedAudit1795800000000 } from '../../../database/migrations/1795800000000-add-social-approval-viewed-audit';
import { AddSocialApprovalCommentVisibility1797400000000 } from '../../../database/migrations/1797400000000-add-social-approval-comment-visibility';
import { AllowOwnScopeSocialApprovals1798800000000 } from '../../../database/migrations/1798800000000-allow-own-scope-social-approvals';
import { CreateSocialApprovalPieces1802900000000 } from '../../../database/migrations/1802900000000-create-social-approval-pieces';
import { AddSocialApprovalPieceDescription1803400000000 } from '../../../database/migrations/1803400000000-add-social-approval-piece-description';
import { AddSocialApprovalCardCustomization1803300000000 } from '../../../database/migrations/1803300000000-add-social-approval-card-customization';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import {
  AgencyUserProfileEntity,
  AgencyWorkspaceUserEntity,
} from '../../agency/entities/agency-settings.entities';
import { ClientAreaMemberModuleAccessEntity } from '../../client-area/entities/client-area-member-module-access.entity';
import { ClientAreaMembershipEntity } from '../../client-area/entities/client-area-membership.entity';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
  CreativeFolderEntity,
  CreativeProductionEntity,
} from '../../social-creative-studio/entities';
import {
  SocialCampaignInstanceEntity,
  SocialContentDestinationEntity,
  SocialContentItemEntity,
  SocialContentRevisionEntity,
  SocialDestinationCreativeEntity,
  SocialPlanEntity,
} from '../../social-planner/entities';
import { AgencyChatChannel, AgencyChatMessage } from '../../team-chat/entities';
import {
  TeamChatChannelKind,
  TeamChatChannelStatus,
  TeamChatChannelVisibility,
} from '../../team-chat/enums';
import { TeamChatCardPostService } from '../../team-chat/services/team-chat-card-post.service';
import { ClientConversationEntity } from '../../client-conversations/entities/client-conversation.entity';
import { ClientConversationMessageEntity } from '../../client-conversations/entities/client-conversation-message.entity';
import { ClientConversationParticipantEntity } from '../../client-conversations/entities/client-conversation-participant.entity';
import { ClientConversationsService } from '../../client-conversations/services/client-conversations.service';
import { ClientConversationApprovalsAdapter } from '../client/client-conversation-approvals.adapter';
import { ClientConversationCardRegistry } from '../client-conversation-card.port';
import {
  SocialApprovalCommentEntity,
  SocialApprovalEventEntity,
  SocialApprovalPieceEntity,
  SocialApprovalRequestEntity,
  SocialApprovalSettingsEntity,
  SocialApprovalSnapshotEntity,
  SocialApprovalStageDecisionEntity,
  SocialApprovalStepEntity,
} from '../entities';
import { SocialApprovalAuthorityService } from '../social-approval-authority.service';
import { SocialApprovalNotificationPublisher } from '../social-approval-notification.publisher';
import { SocialApprovalPiecesService } from '../social-approval-pieces.service';
import { SocialApprovalSettingsService } from '../social-approval-settings.service';
import { SocialApprovalsService } from '../social-approvals.service';
import { ApprovalSubjectResolver } from '../subjects/approval-subject-resolver';
import { TeamChatApprovalCardRegistry } from '../team-chat-approval-card.port';
import {
  APPROVE_INTERNAL_PERMISSION,
  REQUEST_CHANGES_PERMISSION,
  TeamChatApprovalCardsService,
} from './team-chat-approval-cards.service';

const run = describePostgresIntegration();

/** AR5 — the acceptance matrix of the plan (§8), on real PostgreSQL. */
run('AR5 conversations and Team Chat (real PostgreSQL)', () => {
  const schema = `ar5_${randomUUID().replace(/-/g, '')}`;
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const clientA = randomUUID();
  const companyA = randomUUID();
  const scopeA: CompanyAwareScope = {
    tenantId,
    workspaceId,
    agencyClientId: clientA,
    companyContextId: companyA,
  };
  const own: CompanyAwareScope = {
    tenantId,
    workspaceId,
    agencyClientId: null,
    companyContextId: null,
  };
  const ownerUser = randomUUID();
  const operator = randomUUID();
  const designatedMember = randomUUID();
  const clientOwner = randomUUID();
  const clientMemberOne = randomUUID();
  const clientMemberTwo = randomUUID();
  const membershipIds: Record<string, string> = {};
  const channelId = randomUUID();

  const TABLES = [
    MediaAssetEntity,
    SocialPlanEntity,
    SocialContentItemEntity,
    SocialContentRevisionEntity,
    SocialContentDestinationEntity,
    SocialDestinationCreativeEntity,
    SocialCampaignInstanceEntity,
    CreativeFolderEntity,
    CreativeAssetEntity,
    CreativeAssetVersionEntity,
    CreativeProductionEntity,
    ClientAreaMembershipEntity,
    ClientAreaMemberModuleAccessEntity,
    AgencyUserProfileEntity,
    AgencyWorkspaceUserEntity,
    AgencyChatChannel,
    AgencyChatMessage,
    ClientConversationEntity,
    ClientConversationParticipantEntity,
    ClientConversationMessageEntity,
  ];
  const APPROVAL_TABLES = [
    SocialApprovalRequestEntity,
    SocialApprovalCommentEntity,
    SocialApprovalStageDecisionEntity,
    SocialApprovalPieceEntity,
    SocialApprovalStepEntity,
    SocialApprovalSnapshotEntity,
    SocialApprovalEventEntity,
    SocialApprovalSettingsEntity,
  ];

  let db: DataSource;
  let approvals: SocialApprovalsService;
  let settings: SocialApprovalSettingsService;
  let cards: TeamChatApprovalCardsService;
  let adapter: ClientConversationApprovalsAdapter;
  let conversations: ClientConversationsService;
  const processor = { process: jest.fn(async () => ({ status: 'created' })) };
  const gateway = {
    broadcastMessageCreated: jest.fn(),
    broadcastCardChanged: jest.fn(),
  };
  const conversation = {
    publishApprovalCard: jest.fn(
      async () => ({ status: 'posted' }) as { status: 'posted' },
    ),
    announceApprovalActivity: jest.fn(async () => undefined),
    publishDecisionLine: jest.fn(async () => undefined),
  };
  const channels = {
    assertChannelAccess: jest.fn(async () => ({ id: channelId })),
  };
  const grants = {
    getEffectivePermissions: jest.fn(
      async () =>
        new Set([
          APPROVE_INTERNAL_PERMISSION,
          REQUEST_CHANGES_PERMISSION,
          'social.approvals.review.view.assigned',
        ]),
    ),
  };

  function options(entities: DataSourceOptions['entities'], name: string) {
    const base = getAgencyTypeOrmConfig() as Extract<
      DataSourceOptions,
      { type: 'postgres' }
    >;
    return {
      ...base,
      type: 'postgres' as const,
      name,
      entities,
      migrations: [],
      migrationsRun: false,
      synchronize: false,
      schema,
      extra: { options: `-c search_path=${schema},public`, max: 8 },
    };
  }

  beforeAll(async () => {
    const bootstrap = new DataSource(options(TABLES, `${schema}_boot`));
    await bootstrap.initialize();
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    await bootstrap.synchronize();
    await bootstrap.query(`
      CREATE TABLE agency_client_company_contexts (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
        agency_client_id uuid NOT NULL,
        UNIQUE (id, tenant_id, workspace_id, agency_client_id)
      )`);
    await bootstrap.query(
      `INSERT INTO agency_client_company_contexts VALUES ($1,$2,$3,$4)`,
      [companyA, tenantId, workspaceId, clientA],
    );
    const runner = bootstrap.createQueryRunner();
    await new CreateSocialApprovals1795100000000().up(runner);
    await new AddSocialApprovalViewedAudit1795800000000().up(runner);
    await new AddSocialApprovalCommentVisibility1797400000000().up(runner);
    await new AllowOwnScopeSocialApprovals1798800000000().up(runner);
    await new CreateSocialApprovalPieces1802900000000().up(runner);
    await new AddSocialApprovalCardCustomization1803300000000().up(runner);
    await new AddSocialApprovalPieceDescription1803400000000().up(runner);
    await runner.release();
    await bootstrap.destroy();

    db = new DataSource(options([...TABLES, ...APPROVAL_TABLES], schema));
    await db.initialize();

    const resolver = new ApprovalSubjectResolver(
      db.getRepository(CreativeAssetEntity),
      db.getRepository(CreativeAssetVersionEntity),
      db.getRepository(SocialPlanEntity),
      db.getRepository(SocialContentItemEntity),
      db.getRepository(SocialContentRevisionEntity),
      db.getRepository(SocialApprovalSnapshotEntity),
      db.getRepository(SocialApprovalStepEntity),
    );
    const authority = new SocialApprovalAuthorityService();
    settings = new SocialApprovalSettingsService(db, authority);
    const pieces = new SocialApprovalPiecesService(db);
    const conversationRegistry = new ClientConversationCardRegistry();
    conversationRegistry.register(conversation as never);
    const teamChatRegistry = new TeamChatApprovalCardRegistry();
    const publisher = new SocialApprovalNotificationPublisher(
      processor as never,
      undefined,
      conversationRegistry,
      teamChatRegistry,
      settings,
    );
    approvals = new SocialApprovalsService(
      db.getRepository(SocialApprovalRequestEntity),
      db.getRepository(SocialApprovalCommentEntity),
      db.getRepository(SocialApprovalStageDecisionEntity),
      db,
      resolver,
      pieces,
      authority,
      settings,
      publisher,
    );
    const posts = new TeamChatCardPostService(
      db.getRepository(AgencyChatMessage),
      db.getRepository(AgencyChatChannel),
      gateway as never,
    );
    cards = new TeamChatApprovalCardsService(
      db.getRepository(SocialApprovalRequestEntity),
      db.getRepository(SocialApprovalStepEntity),
      db.getRepository(SocialApprovalPieceEntity),
      db.getRepository(AgencyChatMessage),
      posts,
      channels as never,
      approvals,
      settings,
      authority,
      grants as never,
    );
    teamChatRegistry.register(cards);
    adapter = new ClientConversationApprovalsAdapter(
      db.getRepository(SocialApprovalRequestEntity),
      db.getRepository(SocialApprovalCommentEntity),
      db.getRepository(SocialApprovalStepEntity),
      db.getRepository(SocialApprovalPieceEntity),
      {} as never,
      authority,
      settings,
    );

    conversations = new ClientConversationsService(
      db.getRepository(ClientConversationEntity),
      db.getRepository(ClientConversationParticipantEntity),
      db.getRepository(ClientConversationMessageEntity),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await db.getRepository(ClientConversationEntity).save({
      tenantId,
      workspaceId,
      agencyClientId: clientA,
      companyContextId: companyA,
      kind: 'default',
      status: 'active',
    } as never);

    await db.getRepository(AgencyChatChannel).save({
      id: channelId,
      tenantId,
      workspaceId,
      kind: TeamChatChannelKind.CHANNEL,
      visibility: TeamChatChannelVisibility.WORKSPACE,
      status: TeamChatChannelStatus.ACTIVE,
      name: 'aprovacoes',
    } as never);
    await db.getRepository(AgencyWorkspaceUserEntity).save({
      tenantId,
      workspaceId,
      userId: ownerUser,
      name: 'Dona da Agência',
      email: 'dona@agencia.test',
      role: 'owner',
      status: 'active',
    } as never);
    await db.getRepository(AgencyUserProfileEntity).save([
      { tenantId, userId: ownerUser, displayName: 'Dona da Agência' },
      { tenantId, userId: clientOwner, displayName: 'Dona do Cliente' },
    ] as never);

    const addMember = async (
      key: string,
      userId: string,
      role: 'client_owner' | 'client_member',
    ) => {
      const row = await db.getRepository(ClientAreaMembershipEntity).save({
        tenantId,
        workspaceId,
        agencyClientId: clientA,
        companyContextId: companyA,
        userId,
        role,
        status: 'active',
        grantedByUserId: null,
        grantedAt: new Date(),
        revokedByUserId: null,
        revokedAt: null,
      });
      membershipIds[key] = row.id;
      if (role === 'client_member')
        await db.getRepository(ClientAreaMemberModuleAccessEntity).save({
          membershipId: row.id,
          tenantId,
          workspaceId,
          moduleKey: 'approvals',
          level: 'manager',
          grantedByUserId: ownerUser,
          grantedBySurface: 'agency',
        } as never);
    };
    await addMember('ownerA', clientOwner, 'client_owner');
    await addMember('oneA', clientMemberOne, 'client_member');
    await addMember('twoA', clientMemberTwo, 'client_member');
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await db.query(`DELETE FROM social_approval_settings`);
    await db.query(`DELETE FROM agency_chat_messages`);
    await settings.update(scopeA, ownerUser, { teamChatChannelId: channelId });
    await settings.update(own, ownerUser, { teamChatChannelId: channelId });
    jest.clearAllMocks();
  });

  async function draft(scope: CompanyAwareScope) {
    const plan = (await db.getRepository(SocialPlanEntity).save({
      ...scope,
      title: 'Plano',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      status: 'draft',
      deletedAt: null,
    } as never)) as unknown as SocialPlanEntity;
    const item = (await db.getRepository(SocialContentItemEntity).save({
      tenantId,
      workspaceId,
      agencyClientId: scope.agencyClientId,
      planId: plan.id,
      title: `Item ${randomUUID().slice(0, 6)}`,
      hashtags: [],
      planningStatus: 'planned',
      sortOrder: 0,
    } as never)) as unknown as SocialContentItemEntity;
    const revision = (await db.getRepository(SocialContentRevisionEntity).save({
      tenantId,
      workspaceId,
      agencyClientId: scope.agencyClientId,
      contentItemId: item.id,
      revisionNumber: 1,
      copy: 'texto',
      hashtags: [],
      source: 'human',
    } as never)) as unknown as SocialContentRevisionEntity;
    await db
      .getRepository(SocialContentItemEntity)
      .update(item.id, { currentRevisionId: revision.id });
    return approvals.create(scope, operator, {
      subjectType: 'planner_content_revision',
      subjectId: item.id,
      subjectRevisionId: revision.id,
    });
  }

  const messages = () =>
    db.getRepository(AgencyChatMessage).find({
      where: { channelId },
      order: { createdAt: 'ASC' },
    });
  const topLevel = async () =>
    (await messages()).filter((message) => !message.parentMessageId);
  const owner = { tenantId, workspaceId, userId: ownerUser, role: 'owner' };
  const member = (userId: string) => ({
    tenantId,
    workspaceId,
    userId,
    role: 'member',
  });
  const eventsOf = (requestId: string) =>
    db
      .getRepository(SocialApprovalEventEntity)
      .find({ where: { requestId }, order: { createdAt: 'ASC' } });
  const decisionsOf = (approvalRequestId: string) =>
    db
      .getRepository(SocialApprovalStageDecisionEntity)
      .find({ where: { approvalRequestId } });

  async function submitted(scope = scopeA) {
    const request = await draft(scope);
    await approvals.submit(scope, request.id, operator);
    const [card] = await topLevel();
    return { request, card };
  }

  async function atClient() {
    const { request } = await submitted();
    await approvals.approveInternal(scopeA, request.id, ownerUser, 'owner');
    return request;
  }

  describe('Team Chat card and decision', () => {
    it('submit posts one platform card to the configured channel', async () => {
      const { card } = await submitted();
      expect(card.senderUserId).toBeNull();
      expect(card.kind).toBe('text');
      expect((card.metadata?.card as { kind: string }).kind).toBe(
        'approval_card',
      );
    });

    it('no channel configured: no card, and the send still works', async () => {
      await settings.update(scopeA, ownerUser, { teamChatChannelId: null });
      const request = await draft(scopeA);
      const sent = await approvals.submit(scopeA, request.id, operator);
      expect(sent.status).toBe('awaiting_internal_review');
      expect(await messages()).toHaveLength(0);
    });

    it('deciding on the card writes the same trail as the screen, with its own surface', async () => {
      const { request, card } = await submitted();
      const view = await cards.approve(owner, channelId, card.id);

      expect(view.state.status).toBe('awaiting_client');
      expect(view.actions.canApprove).toBe(false);
      const events = await eventsOf(request.id);
      expect(events.map((event) => event.type)).toEqual([
        'sent',
        'approved',
        'sent',
      ]);
      expect(events[1].surface).toBe('team_chat');
      expect(events[1].actorName).toBe('Dona da Agência');
      const decisions = await decisionsOf(request.id);
      expect(decisions).toEqual([
        expect.objectContaining({ stage: 'internal', decision: 'approved' }),
      ]);
      // Entering the client stage from the card still publishes to the client.
      expect(conversation.publishApprovalCard).toHaveBeenCalledTimes(1);
      expect(gateway.broadcastCardChanged).toHaveBeenCalled();
    });

    it('records the decision once, as a reply to the card', async () => {
      const { card } = await submitted();
      await cards.approve(owner, channelId, card.id);
      const replies = (await messages()).filter(
        (message) => message.parentMessageId === card.id,
      );
      expect(replies).toHaveLength(1);
      expect(replies[0].body).toContain('Dona da Agência aprovou internamente');
      expect(replies[0].senderUserId).toBeNull();
    });

    it('a decision taken on the board also answers the card', async () => {
      const { request, card } = await submitted();
      await approvals.approveInternal(scopeA, request.id, ownerUser, 'owner');
      const replies = (await messages()).filter(
        (message) => message.parentMessageId === card.id,
      );
      expect(replies).toHaveLength(1);
    });

    it('a second attempt answers 409 and the card already shows the new status', async () => {
      const { card } = await submitted();
      await cards.approve(owner, channelId, card.id);
      await expect(
        cards.approve(owner, channelId, card.id),
      ).rejects.toBeInstanceOf(ConflictException);
      const view = await cards.view(owner, channelId, card.id);
      expect(view.state.status).toBe('awaiting_client');
      expect(view.actions).toMatchObject({
        canApprove: false,
        canRequestChanges: false,
      });
    });

    it('requests changes with the team_chat surface', async () => {
      const { request, card } = await submitted();
      const view = await cards.requestChanges(
        owner,
        channelId,
        card.id,
        'Ajustar o CTA',
      );
      expect(view.state.status).toBe('changes_requested');
      const events = await eventsOf(request.id);
      expect(events.at(-1)).toMatchObject({
        type: 'changes_requested',
        surface: 'team_chat',
      });
    });

    it('in the own scope the internal decision on the card is final', async () => {
      const { request, card } = await submitted(own);
      const view = await cards.approve(owner, channelId, card.id);
      expect(view.state.status).toBe('approved');
      const saved = await db
        .getRepository(SocialApprovalRequestEntity)
        .findOneByOrFail({ id: request.id });
      expect(saved.resolution).toBe('internal_final');
      expect(conversation.publishDecisionLine).not.toHaveBeenCalled();
    });
  });

  describe('who may act (D-07, D-17)', () => {
    it('being in the channel does not give actions: empty list means the Owner', async () => {
      const { card } = await submitted();
      const notOwner = await cards.view(
        member(designatedMember),
        channelId,
        card.id,
      );
      expect(notOwner.actions.canApprove).toBe(false);
      await expect(
        cards.approve(member(designatedMember), channelId, card.id),
      ).rejects.toBeInstanceOf(ForbiddenException);

      const asOwner = await cards.view(owner, channelId, card.id);
      expect(asOwner.actions.canApprove).toBe(true);
    });

    it('a filled list gives the action to the listed person only', async () => {
      await settings.update(scopeA, ownerUser, {
        internalApproverUserIds: [],
      });
      await db
        .getRepository(SocialApprovalSettingsEntity)
        .update(
          { agencyClientId: clientA },
          { internalApproverUserIds: [designatedMember] },
        );
      const { card } = await submitted();
      const listed = await cards.view(
        member(designatedMember),
        channelId,
        card.id,
      );
      expect(listed.actions.canApprove).toBe(true);
      const ownerView = await cards.view(owner, channelId, card.id);
      expect(ownerView.actions.canApprove).toBe(false);
    });

    it('no route key means no action, even when designated', async () => {
      const { card } = await submitted();
      grants.getEffectivePermissions.mockResolvedValueOnce(new Set());
      const view = await cards.view(owner, channelId, card.id);
      expect(view.actions).toEqual({
        canApprove: false,
        canRequestChanges: false,
        canOpen: false,
      });
    });

    it('a card a person wrote is ignored on read and refused on decide', async () => {
      const { request } = await submitted();
      const forged = (await db.getRepository(AgencyChatMessage).save({
        tenantId,
        workspaceId,
        channelId,
        senderUserId: designatedMember,
        kind: 'text',
        status: 'sent',
        body: 'forjado',
        metadata: {
          card: { kind: 'approval_card', approvalId: request.id },
        },
      } as never)) as unknown as AgencyChatMessage;
      const resolved = await cards.resolve(owner, [forged as never]);
      expect(resolved.size).toBe(0);
      await expect(
        cards.approve(owner, channelId, forged.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        cards.view(owner, channelId, forged.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a card of another channel is 404', async () => {
      const { card } = await submitted();
      await expect(
        cards.view(owner, randomUUID(), card.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('batch (D-19)', () => {
    async function batched(batchId: string) {
      const first = await draft(scopeA);
      const second = await draft(scopeA);
      await approvals.submitExisting(scopeA, first.id, operator, { batchId });
      await approvals.submitExisting(scopeA, second.id, operator, { batchId });
      return { first, second };
    }

    it('a batch is one card and one notification', async () => {
      await batched(randomUUID());
      expect(await topLevel()).toHaveLength(1);
      const ids = (
        processor.process.mock.calls as unknown as Array<[{ eventId: string }]>
      ).map(([event]) => event.eventId);
      expect(new Set(ids).size).toBe(1);
    });

    it('the batch card summarizes the items and is decided piece by piece', async () => {
      const { first } = await batched(randomUUID());
      const [card] = await topLevel();
      const view = await cards.view(owner, channelId, card.id);
      expect(view.state.batch).toMatchObject({ total: 2, pending: 2 });
      expect(view.actions.canApprove).toBe(false);
      await expect(
        cards.approve(owner, channelId, card.id),
      ).rejects.toBeInstanceOf(ConflictException);

      await approvals.approveInternal(scopeA, first.id, ownerUser, 'owner');
      const after = await cards.view(owner, channelId, card.id);
      expect(after.state.batch).toMatchObject({ total: 2, pending: 1 });
    });

    it('entering the client stage announces the batch once', async () => {
      const { first, second } = await batched(randomUUID());
      await approvals.approveInternal(scopeA, first.id, ownerUser, 'owner');
      await approvals.approveInternal(scopeA, second.id, ownerUser, 'owner');
      const keys = (
        conversation.publishApprovalCard.mock.calls as unknown as Array<
          [{ dedupeKey: string }]
        >
      ).map(([input]) => input.dedupeKey);
      expect(new Set(keys).size).toBe(1);
    });

    it('a resend of one changed item is its own card', async () => {
      const { first } = await batched(randomUUID());
      await approvals.requestChanges(
        scopeA,
        first.id,
        ownerUser,
        'Ajustar',
        'owner',
      );
      await approvals.submit(scopeA, first.id, operator);
      const row = await db
        .getRepository(SocialApprovalRequestEntity)
        .findOneByOrFail({ id: first.id });
      expect(row.batchId).toBeNull();
      expect(await topLevel()).toHaveLength(2);
    });

    it('two publications racing for one batch land once', async () => {
      const first = await draft(scopeA);
      const batchId = randomUUID();
      await db
        .getRepository(SocialApprovalRequestEntity)
        .update({ id: first.id }, { batchId });
      const row = await db
        .getRepository(SocialApprovalRequestEntity)
        .findOneByOrFail({ id: first.id });
      const key = `social.approval.awaiting_internal_review:batch:${batchId}`;
      await Promise.all([
        cards.publishCard({ approval: row, channelId, dedupeKey: key }),
        cards.publishCard({ approval: row, channelId, dedupeKey: key }),
      ]);
      expect(await messages()).toHaveLength(1);
    });
  });

  describe('conversation', () => {
    it('respects send_to_conversation', async () => {
      await settings.update(scopeA, ownerUser, { sendToConversation: false });
      await atClient();
      expect(conversation.publishApprovalCard).not.toHaveBeenCalled();
    });

    it('a decision from the conversation carries its surface and writes one line', async () => {
      const request = await atClient();
      await approvals.clientApprove(
        scopeA,
        request.id,
        { type: 'user', userId: clientOwner },
        undefined,
        'client_conversation',
      );
      const events = await eventsOf(request.id);
      const approved = events.at(-1);
      expect(approved).toMatchObject({
        type: 'approved',
        surface: 'client_conversation',
      });
      expect(conversation.publishDecisionLine).toHaveBeenCalledTimes(1);
      expect(conversation.publishDecisionLine).toHaveBeenCalledWith(
        expect.objectContaining({
          record: expect.objectContaining({
            eventId: approved?.id,
            decision: 'approved',
            stage: 'client',
          }),
        }),
      );
    });

    it('never writes the internal decision to the client conversation', async () => {
      await atClient();
      expect(conversation.publishDecisionLine).not.toHaveBeenCalled();
    });

    it('a second decision on the conversation card is 409', async () => {
      const request = await atClient();
      const actor = { type: 'user' as const, userId: clientOwner };
      await approvals.clientApprove(scopeA, request.id, actor);
      await expect(
        approvals.clientApprove(scopeA, request.id, actor),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('D-17 on read: without designation there is no action', async () => {
      const request = await atClient();
      const scope = scopeA as never;
      const asMember = await adapter.resolveCards(scope, [request.id], {
        userId: clientMemberOne,
      });
      const state = asMember.get(request.id)!;
      expect(state.designated).toBe(false);
      expect(state.needsAction).toBe(false);
      expect(
        adapter.resolveActions({
          state,
          approvalsModuleEnabled: true,
          permissions: { comment: true, decide: true },
        }).canDecide,
      ).toBe(false);

      const asOwner = await adapter.resolveCards(scope, [request.id], {
        userId: clientOwner,
      });
      expect(asOwner.get(request.id)).toMatchObject({
        designated: true,
        needsAction: true,
        piece: expect.objectContaining({
          kind: 'content_item',
          stepKind: 'copy',
        }),
      });
    });

    it('"Todos": the action goes away only for who already decided', async () => {
      await settings.update(scopeA, ownerUser, {
        clientDecisionPolicy: 'all',
        clientApproverMembershipIds: [membershipIds.oneA, membershipIds.twoA],
      });
      const request = await atClient();
      await approvals.clientApprove(scopeA, request.id, {
        type: 'user',
        userId: clientMemberOne,
      });
      const scope = scopeA as never;
      const decided = await adapter.resolveCards(scope, [request.id], {
        userId: clientMemberOne,
      });
      const pending = await adapter.resolveCards(scope, [request.id], {
        userId: clientMemberTwo,
      });
      expect(decided.get(request.id)?.designated).toBe(false);
      expect(pending.get(request.id)?.designated).toBe(true);
      expect(pending.get(request.id)?.status).toBe('awaiting_your_review');
    });

    it('a batch card sums what the client can see', async () => {
      const batchId = randomUUID();
      const first = await draft(scopeA);
      const second = await draft(scopeA);
      await approvals.submitExisting(scopeA, first.id, operator, { batchId });
      await approvals.submitExisting(scopeA, second.id, operator, { batchId });
      await approvals.approveInternal(scopeA, first.id, ownerUser, 'owner');
      const scope = scopeA as never;

      const single = await adapter.resolveCards(scope, [first.id], {
        userId: clientOwner,
      });
      expect(single.get(first.id)?.batch).toBeUndefined();

      await approvals.approveInternal(scopeA, second.id, ownerUser, 'owner');
      const both = await adapter.resolveCards(scope, [first.id], {
        userId: clientOwner,
      });
      expect(both.get(first.id)?.batch).toMatchObject({ total: 2, pending: 2 });
    });
  });

  describe('conversation timeline writes', () => {
    const conversationScope = () =>
      ({
        tenantId,
        workspaceId,
        agencyClientId: clientA,
        companyContextId: companyA,
      }) as never;
    const rows = () =>
      db.getRepository(ClientConversationMessageEntity).find({
        where: { companyContextId: companyA },
      });

    beforeEach(async () => {
      await db.query(`DELETE FROM client_conversation_messages`);
    });

    it('a decision line lands once per event, as a system row with no author', async () => {
      const dedupe = `social.approval.decision:${randomUUID()}`;
      const first = await conversations.publishSystemLine(
        conversationScope(),
        'Fulana aprovou Post (r1).',
        { decision: { approvalId: randomUUID(), type: 'approved' } },
        dedupe,
      );
      const second = await conversations.publishSystemLine(
        conversationScope(),
        'Fulana aprovou Post (r1).',
        { decision: { approvalId: randomUUID(), type: 'approved' } },
        dedupe,
      );
      expect(first.status).toBe('posted');
      expect(second.status).toBe('duplicate');
      const stored = await rows();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        kind: 'system',
        senderSurface: 'agency',
        senderUserId: null,
      });
    });

    it('two cards racing for one key land once', async () => {
      const card = {
        kind: 'approval_card' as const,
        approvalId: randomUUID(),
        title: 'Post',
        version: 'r1',
      };
      const outcomes = await Promise.all([
        conversations.publishCard(conversationScope(), card, 'race-key'),
        conversations.publishCard(conversationScope(), card, 'race-key'),
      ]);
      expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([
        'duplicate',
        'posted',
      ]);
      expect(await rows()).toHaveLength(1);
    });

    it('a company with no conversation yet is skipped, not provisioned', async () => {
      const result = await conversations.publishSystemLine(
        {
          ...(conversationScope() as object),
          companyContextId: randomUUID(),
        } as never,
        'x',
        { decision: { approvalId: randomUUID(), type: 'approved' } },
        'other',
      );
      expect(result.status).toBe('skipped');
    });
  });

  describe('failure isolation', () => {
    it('a card that cannot be posted never reverts the transition', async () => {
      // Archived after being configured: the card has nowhere to go.
      const channelsRepo = db.getRepository(AgencyChatChannel);
      await channelsRepo.update(
        { id: channelId },
        { status: TeamChatChannelStatus.ARCHIVED },
      );
      try {
        const request = await draft(scopeA);
        const sent = await approvals.submit(scopeA, request.id, operator);
        expect(sent.status).toBe('awaiting_internal_review');
        expect(await messages()).toHaveLength(0);
      } finally {
        await channelsRepo.update(
          { id: channelId },
          { status: TeamChatChannelStatus.ACTIVE },
        );
      }
    });

    it('a decision survives every publication failing', async () => {
      conversation.publishApprovalCard.mockRejectedValueOnce(new Error('down'));
      conversation.publishDecisionLine.mockRejectedValueOnce(new Error('down'));
      const request = await atClient();
      const saved = await approvals.clientApprove(scopeA, request.id, {
        type: 'user',
        userId: clientOwner,
      });
      expect(saved.status).toBe('approved');
      const row = await db
        .getRepository(SocialApprovalRequestEntity)
        .findOneByOrFail({ id: request.id });
      expect(row.status).toBe('approved');
    });
  });
});
