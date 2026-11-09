import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { AgencyClient } from '../../clients/entities/agency-client.entity';
import { AgencyClientCompanyContext } from '../../clients/entities/agency-client-company-context.entity';
import { AgencyClientStatus } from '../../clients/enums';
import { ClientAreaMembershipEntity } from '../../client-area/entities/client-area-membership.entity';
import {
  AgencyUserProfileEntity,
  AgencyWorkspaceUserEntity,
} from '../../agency/entities/agency-settings.entities';
import {
  approvalCardBody,
  CLIENT_CONVERSATION_ERROR_CODES,
  decodeConversationCursor,
  isUuid,
  timelineSourceRank,
  type ClientConversationApprovalCard,
  type ClientConversationSettingsRequestCard,
  type ClientConversationCursor,
  type ClientConversationMessageKind,
  type ClientConversationMessageMetadata,
  type ClientConversationSurface,
} from '../client-conversation.types';
import {
  ClientConversationEntity,
  ClientConversationMessageEntity,
  ClientConversationParticipantEntity,
} from '../entities';
import {
  evaluateConversationAccess,
  unreadWatermark,
  type ClientConversationScope,
} from './client-conversation-access';
import { mergeTimelinePage } from './client-conversation-timeline';

const AGENCY_CONNECTION = 'agency';

/** Max messages a single page may return, whatever the caller asks for. */
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;
/** Keeps one message from being a denial-of-service against the timeline. */
const MAX_BODY_LENGTH = 8000;
/** TC-CL1 — a 256px avatar as base64 JPEG/PNG/WebP fits well under this. */
const MAX_AVATAR_LENGTH = 400_000;
const AVATAR_PATTERN =
  /^(data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+|https?:\/\/\S+)$/;

function conversationNotFound() {
  // One answer for "no such conversation", "another company's conversation"
  // and a malformed id, so nothing about other companies is enumerable — the
  // same 404-not-403 choice CCOM0.5 made for Team Chat channels.
  return new NotFoundException({
    statusCode: 404,
    error: 'Not Found',
    message: 'Conversation is not available.',
    code: CLIENT_CONVERSATION_ERROR_CODES.conversationNotFound,
  });
}

export type ConversationActor = {
  surface: ClientConversationSurface;
  userId: string;
  /** Required for a `client_area` actor; the membership that justifies the seat. */
  membershipId?: string | null;
};

export type ConversationMessageView = {
  id: string;
  conversationId: string;
  senderSurface: ClientConversationSurface;
  senderUserId: string | null;
  body: string;
  kind: ClientConversationMessageKind;
  metadata: ClientConversationMessageMetadata | null;
  createdAt: Date;
  /** Attachments are projected by `ClientConversationAttachmentsService`. */
  attachments: ConversationAttachmentView[];
  /**
   * CCOM2 §20 — the discriminator of the timeline union. Always this constant
   * for a stored message; the approval-comment item carries the other value.
   * It is part of the sort key, so it is emitted rather than inferred by the
   * client from the presence of other fields.
   */
  source: 'conversation_message';
};

export type ConversationAttachmentView = {
  /** The opaque ref the surfaces receive. Never a storage key (§15). */
  id: string;
  kind: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
};

export type ConversationView = {
  id: string;
  companyContextId: string;
  companyDisplayName: string | null;
  status: string;
  lastMessageAt: Date | null;
  unreadCount: number;
  lastReadAt: Date | null;
  /** TC-CL1 — overrides shown on both surfaces; null = company name/logo. */
  title: string | null;
  description: string | null;
  avatarUrl: string | null;
  /** The reader's own mute, or null. */
  mutedUntil: Date | null;
};

/** TC-CL1 — one live seat, as the Agency members panel shows it. */
export type ConversationParticipantView = {
  id: string;
  surface: 'agency' | 'client_area';
  userId: string;
  membershipId: string | null;
  role: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  joinedAt: Date;
};

/** TC-CL1 — someone who could be seated, and whether they already are. */
export type ConversationMemberCandidateView = {
  surface: 'agency' | 'client_area';
  userId: string;
  membershipId: string | null;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  isMember: boolean;
};

/**
 * CCOM1 — the Client Conversation domain.
 *
 * Surface-agnostic by construction: every method takes a `ClientConversationScope`
 * that the *caller's* guard chain already proved, plus a `ConversationActor`
 * saying which door the actor came through. This service never authenticates
 * anyone and never reads a header, a token or a request — the Client Area
 * controller arrives with a `ClientAreaContext`, the Agency controller with an
 * Agency `RequestContext` plus client access, and both hand over the same
 * proven tuple. That is what lets one implementation serve two boundaries
 * without the boundaries leaking into each other (CCOM1 §27/§37).
 */
@Injectable()
export class ClientConversationsService {
  constructor(
    @InjectRepository(ClientConversationEntity, AGENCY_CONNECTION)
    private readonly conversations: Repository<ClientConversationEntity>,
    @InjectRepository(ClientConversationParticipantEntity, AGENCY_CONNECTION)
    private readonly participants: Repository<ClientConversationParticipantEntity>,
    @InjectRepository(ClientConversationMessageEntity, AGENCY_CONNECTION)
    private readonly messages: Repository<ClientConversationMessageEntity>,
    @InjectRepository(AgencyClientCompanyContext, AGENCY_CONNECTION)
    private readonly companyContexts: Repository<AgencyClientCompanyContext>,
    @InjectRepository(AgencyClient, AGENCY_CONNECTION)
    private readonly clients: Repository<AgencyClient>,
    @InjectRepository(ClientAreaMembershipEntity, AGENCY_CONNECTION)
    private readonly memberships: Repository<ClientAreaMembershipEntity>,
    @InjectRepository(AgencyWorkspaceUserEntity, AGENCY_CONNECTION)
    private readonly workspaceUsers: Repository<AgencyWorkspaceUserEntity>,
    @InjectRepository(AgencyUserProfileEntity, AGENCY_CONNECTION)
    private readonly profiles: Repository<AgencyUserProfileEntity>,
  ) {}

  /**
   * Validates that the scope names a real, active Company Context of a real,
   * active Agency Client (CCOM1 §3).
   *
   * The Company is never inferred from the Agency Client, even though V1 often
   * has one company per client: the company is the operational unit, and
   * guessing it would silently cross companies for any client that has two.
   */
  private async assertCompany(scope: ClientConversationScope): Promise<void> {
    const [company, client] = await Promise.all([
      this.companyContexts.findOne({
        where: {
          id: scope.companyContextId,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
        },
      }),
      this.clients.findOne({
        where: {
          id: scope.agencyClientId,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
        },
      }),
    ]);

    if (
      !company ||
      company.status !== 'active' ||
      company.archivedAt ||
      !client ||
      client.status !== AgencyClientStatus.Active ||
      client.archivedAt
    ) {
      throw conversationNotFound();
    }
  }

  /**
   * The company's default conversation, created on first use.
   *
   * Provisioning choice (CCOM1 §25): the conversation and the caller's own
   * participant row are ensured here, idempotently, on the first authorized
   * touch — option A made deterministic. Option C (create at membership grant)
   * was rejected because memberships already exist in production and would need
   * a backfill whose correctness depends on replaying revocations; option B
   * alone cannot provision an *Agency* seat, since no event marks an operator
   * as relevant to a company. Both chosen writes are `ON CONFLICT DO NOTHING`
   * shaped, so two concurrent first requests converge on one row rather than
   * racing — the partial unique index is the arbiter, not application order.
   */
  async ensureDefaultConversation(
    scope: ClientConversationScope,
    actor: ConversationActor,
  ): Promise<ClientConversationEntity> {
    await this.assertActorEligible(scope, actor);
    const conversation = await this.ensureConversation(scope);
    // TC-CL1 — membership is explicit: provisioning the row never seats.
    await this.requireParticipant(conversation, actor);
    return conversation;
  }

  /**
   * TC-CL1 — the company's default conversation, created if absent, seating
   * nobody. Used by platform publishers and by the Agency "start" path, which
   * then seats people explicitly.
   */
  async ensureConversation(
    scope: ClientConversationScope,
  ): Promise<ClientConversationEntity> {
    await this.assertCompany(scope);
    const existing = await this.findDefaultEntity(scope);
    return existing ?? (await this.insertConversation(scope));
  }

  private findDefaultEntity(scope: ClientConversationScope) {
    return this.conversations.findOne({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        kind: 'default',
        status: 'active',
      },
    });
  }

  private async insertConversation(
    scope: ClientConversationScope,
  ): Promise<ClientConversationEntity> {
    await this.conversations
      .createQueryBuilder()
      .insert()
      .values({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        kind: 'default',
        status: 'active',
      })
      // The partial unique index is the arbiter of "one active conversation
      // per company": a concurrent first request is ignored here rather than
      // raising, and both callers then read the same winning row below.
      .orIgnore()
      .execute();

    /**
     * Deliberately re-read rather than using `RETURNING *`.
     *
     * `insert().returning('*')` resolves to `raw`, which is the driver's
     * snake_case row — `tenant_id`, not `tenantId`. Casting that to the entity
     * type compiles and then hands every consumer `undefined` for every
     * column, which first surfaced as a NOT NULL violation on the participant
     * insert two calls later. A read through the repository applies the column
     * mapping, and `orIgnore` means we need this path for the concurrent case
     * anyway.
     */
    const conversation = await this.conversations.findOne({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        kind: 'default',
        status: 'active',
      },
    });

    if (!conversation) throw conversationNotFound();
    await this.seatDefaultMembers(conversation);
    return conversation;
  }

  /**
   * TC-CL1 — the seats a conversation is born with, so turning the module on
   * never yields an empty room: every active Agency Owner/Admin and the
   * company's active Client Owner. Insert-only (`ON CONFLICT DO NOTHING`, no
   * revival): someone removed later is not re-added by a concurrent first
   * request, and nobody else is ever seated automatically.
   */
  private async seatDefaultMembers(
    conversation: ClientConversationEntity,
  ): Promise<void> {
    const [operators, owners] = await Promise.all([
      this.workspaceUsers.find({
        where: {
          tenantId: conversation.tenantId,
          workspaceId: conversation.workspaceId,
          status: 'active',
          role: In(['owner', 'admin']),
        },
      }),
      this.memberships.find({
        where: {
          tenantId: conversation.tenantId,
          workspaceId: conversation.workspaceId,
          agencyClientId: conversation.agencyClientId,
          companyContextId: conversation.companyContextId,
          status: 'active',
          role: 'client_owner',
        },
      }),
    ]);
    const now = new Date();
    const rows = [
      ...operators
        .filter((row) => row.userId)
        .map((row) => ({
          surface: 'agency' as const,
          userId: row.userId as string,
          membershipId: null,
          role: row.role === 'owner' ? ('owner' as const) : ('member' as const),
        })),
      ...owners.map((row) => ({
        surface: 'client_area' as const,
        userId: row.userId,
        membershipId: row.id,
        role: 'member' as const,
      })),
    ];
    if (!rows.length) return;
    await this.participants
      .createQueryBuilder()
      .insert()
      .values(
        rows.map((row) => ({
          tenantId: conversation.tenantId,
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
          companyContextId: conversation.companyContextId,
          participantSurface: row.surface,
          userId: row.userId,
          membershipId: row.membershipId,
          role: row.role,
          joinedAt: now,
          lastReadAt: now,
          addedByUserId: null,
        })),
      )
      .orIgnore()
      .execute();
  }

  /**
   * Re-proves that the actor may hold a seat, on every touch.
   *
   * A client actor must carry a live, active membership for *this* company
   * (CCOM1 §8). The membership id is not taken on trust from the caller: it is
   * re-read and matched against the user and company, so a stale or borrowed id
   * fails. An agency actor must be an active workspace user (§7) and needs no
   * membership — and the absence of a `workspace_users` row for client people is
   * precisely what makes `participant_surface='client_area'` unforgeable from
   * the agency side (§9).
   */
  private async assertActorEligible(
    scope: ClientConversationScope,
    actor: ConversationActor,
  ): Promise<void> {
    if (actor.surface === 'client_area') {
      const membership = await this.memberships.findOne({
        where: {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          companyContextId: scope.companyContextId,
          userId: actor.userId,
          status: 'active',
        },
      });

      if (
        !membership ||
        (actor.membershipId && membership.id !== actor.membershipId)
      ) {
        throw conversationNotFound();
      }
      return;
    }

    const operator = await this.workspaceUsers.exists({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        userId: actor.userId,
        status: 'active',
      },
    });

    if (!operator) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'You are not an active user of this workspace.',
        code: CLIENT_CONVERSATION_ERROR_CODES.notAParticipant,
      });
    }
  }

  /**
   * Creates the actor's seat if absent, idempotently.
   *
   * `last_read_at` is seeded to `joined_at`, so a person joining an existing
   * conversation does not see its whole history as unread (CCOM1 §45). A row
   * whose `left_at` was set by a revocation is revived rather than duplicated:
   * the unique key is `(conversation, surface, user)`, and re-granting access
   * should restore the seat, not fork it.
   */
  /**
   * TC-CL1 — the actor's live seat, or 404.
   *
   * Membership is explicit since TC-CL1: access to the client (Agency) or a
   * company membership (Client Area) makes someone *eligible* to be seated,
   * never seated. A missing or left seat answers exactly like a conversation
   * that does not exist, so a non-member learns nothing about it.
   */
  private async requireParticipant(
    conversation: ClientConversationEntity,
    actor: ConversationActor,
  ): Promise<ClientConversationParticipantEntity> {
    const participant = await this.findParticipant(conversation.id, actor);
    if (!participant || participant.leftAt) throw conversationNotFound();
    return participant;
  }

  /**
   * Seats someone, idempotently. A row whose `left_at` is set is revived rather
   * than duplicated (the unique key is `(conversation, surface, user)`), with
   * the watermark reset so the history before joining is not unread.
   */
  private async seatParticipant(
    conversation: ClientConversationEntity,
    seat: {
      surface: 'agency' | 'client_area';
      userId: string;
      membershipId: string | null;
      role: 'member' | 'owner';
      addedByUserId: string | null;
    },
  ): Promise<ClientConversationParticipantEntity> {
    const now = new Date();

    await this.participants
      .createQueryBuilder()
      .insert()
      .values({
        tenantId: conversation.tenantId,
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
        companyContextId: conversation.companyContextId,
        participantSurface: seat.surface,
        userId: seat.userId,
        membershipId: seat.surface === 'client_area' ? seat.membershipId : null,
        role: seat.role,
        joinedAt: now,
        lastReadAt: now,
        addedByUserId: seat.addedByUserId,
      })
      .orIgnore()
      .execute();

    const participant = await this.findParticipant(conversation.id, {
      surface: seat.surface,
      userId: seat.userId,
    });
    if (!participant) throw conversationNotFound();

    if (participant.leftAt) {
      participant.leftAt = null;
      participant.joinedAt = now;
      participant.lastReadAt = now;
      participant.addedByUserId = seat.addedByUserId;
      if (seat.surface === 'client_area')
        participant.membershipId = seat.membershipId;
      await this.participants.save(participant);
    }

    return participant;
  }

  private findParticipant(
    conversationId: string,
    actor: Pick<ConversationActor, 'surface' | 'userId'>,
  ) {
    return this.participants.findOne({
      where: {
        conversationId,
        participantSurface: actor.surface,
        userId: actor.userId,
      },
    });
  }

  /**
   * Loads a conversation by id for a caller whose scope is already proven.
   *
   * The id from the path is a *request*, never authority: the row is fetched
   * and then checked against the proven scope, so a valid UUID belonging to
   * another company answers 404 exactly like a nonexistent one (§51).
   */
  async findAccessible(
    scope: ClientConversationScope,
    conversationId: unknown,
    options: { requireActive?: boolean } = {},
  ): Promise<ClientConversationEntity> {
    /**
     * Shape first, ownership second. A non-UUID id would otherwise reach
     * PostgreSQL and raise a cast error as a 500 — an answer a caller can
     * trigger at will, and one that distinguishes "malformed" from "not
     * yours" when both should be indistinguishable.
     */
    if (!isUuid(conversationId)) {
      throw conversationNotFound();
    }

    const conversation = await this.conversations.findOne({
      where: { id: conversationId },
    });

    if (!conversation) throw conversationNotFound();

    const decision = evaluateConversationAccess(scope, conversation, options);
    if (!decision.allowed) {
      if (decision.reason === 'archived') {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          message: 'This conversation is archived.',
          code: CLIENT_CONVERSATION_ERROR_CODES.conversationArchived,
        });
      }
      throw conversationNotFound();
    }

    return conversation;
  }

  /** The company's conversations, as the actor's own seat sees them. */
  async list(
    scope: ClientConversationScope,
    actor: ConversationActor,
    companyDisplayName: string | null = null,
  ): Promise<ConversationView[]> {
    // TC-CL1 — a non-member sees no conversation (not an error): listing never
    // provisions and never seats.
    await this.assertCompany(scope);
    await this.assertActorEligible(scope, actor);
    // Provisioning (with its default seats) happens on the first visit of
    // either side once the module is on; it never seats the viewer as such.
    const conversation = await this.ensureConversation(scope);
    const participant = await this.findParticipant(conversation.id, actor);
    if (!participant || participant.leftAt) return [];
    return [await this.project(conversation, actor, companyDisplayName)];
  }

  async detail(
    scope: ClientConversationScope,
    actor: ConversationActor,
    conversationId: unknown,
    companyDisplayName: string | null = null,
  ): Promise<ConversationView> {
    const conversation = await this.findAccessible(scope, conversationId);
    await this.assertActorEligible(scope, actor);
    await this.requireParticipant(conversation, actor);
    return this.project(conversation, actor, companyDisplayName);
  }

  /**
   * TC-CL1 — the default conversation as an Agency manager sees it, member or
   * not. Read-state fields are the manager's own (zero when not seated).
   */
  async managedView(
    scope: ClientConversationScope,
    userId: string,
    companyDisplayName: string | null,
  ): Promise<ConversationView & { isMember: boolean }> {
    const conversation = await this.ensureConversation(scope);
    const actor = { surface: 'agency' as const, userId };
    const participant = await this.findParticipant(conversation.id, actor);
    const view = await this.project(conversation, actor, companyDisplayName);
    return { ...view, isMember: Boolean(participant && !participant.leftAt) };
  }

  /** TC-CL1 — edits the overrides. `undefined` keeps, `''`/null clears. */
  async updateDetails(
    scope: ClientConversationScope,
    conversationId: unknown,
    input: {
      title?: string | null;
      description?: string | null;
      avatarUrl?: string | null;
    },
  ): Promise<ClientConversationEntity> {
    const conversation = await this.findAccessible(scope, conversationId, {
      requireActive: true,
    });
    const clean = (value: string | null | undefined, max: number) =>
      value === undefined ? undefined : value?.trim().slice(0, max) || null;
    const patch: Partial<ClientConversationEntity> = {};
    const title = clean(input.title, 120);
    const description = clean(input.description, 500);
    const avatarUrl = clean(input.avatarUrl, MAX_AVATAR_LENGTH);
    // Only an inline raster image or an http(s) URL; anything else (e.g. a
    // `javascript:` or SVG data URL) would be rendered on both surfaces.
    if (avatarUrl && !AVATAR_PATTERN.test(avatarUrl))
      throw new BadRequestException('Invalid avatar.');
    if (title !== undefined) patch.title = title;
    if (description !== undefined) patch.description = description;
    if (avatarUrl !== undefined) patch.avatarUrl = avatarUrl;
    if (Object.keys(patch).length)
      await this.conversations.update({ id: conversation.id }, patch);
    return { ...conversation, ...patch };
  }

  /** TC-CL1 — the reader's own mute (null = notifications on). */
  async setMuted(
    scope: ClientConversationScope,
    actor: ConversationActor,
    conversationId: unknown,
    mutedUntil: Date | null,
  ): Promise<{ mutedUntil: Date | null }> {
    const conversation = await this.findAccessible(scope, conversationId);
    await this.assertActorEligible(scope, actor);
    const participant = await this.requireParticipant(conversation, actor);
    await this.participants.update({ id: participant.id }, { mutedUntil });
    return { mutedUntil };
  }

  /** TC-CL1 — live seats with identity, for the Agency members panel. */
  async listParticipants(
    scope: ClientConversationScope,
    conversationId: unknown,
  ): Promise<ConversationParticipantView[]> {
    const conversation = await this.findAccessible(scope, conversationId);
    const rows = await this.participants.find({
      where: { conversationId: conversation.id, leftAt: IsNull() },
      order: { joinedAt: 'ASC' },
    });
    const identity = await this.identities(
      scope,
      rows.map((row) => row.userId),
    );
    return rows.map((row) => {
      const who = identity.get(row.userId);
      return {
        id: row.id,
        surface: row.participantSurface,
        userId: row.userId,
        membershipId: row.membershipId,
        role: row.role,
        displayName: who?.displayName || who?.email || 'Usuário',
        email: who?.email ?? null,
        avatarUrl: who?.avatarUrl ?? null,
        joinedAt: row.joinedAt,
      };
    });
  }

  /**
   * TC-CL1 — who may be seated: every active Agency workspace user (seating
   * one grants this conversation only, never the client's assets), and every
   * active Client Area membership *of this company* — nobody without a link to
   * the company can ever appear here.
   */
  async listMemberCandidates(
    scope: ClientConversationScope,
    conversationId: unknown,
  ): Promise<ConversationMemberCandidateView[]> {
    const conversation = await this.findAccessible(scope, conversationId);
    const [operators, memberships, seats] = await Promise.all([
      this.workspaceUsers.find({
        where: {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          status: 'active',
        },
      }),
      this.memberships.find({
        where: {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          companyContextId: scope.companyContextId,
          status: 'active',
        },
      }),
      this.participants.find({
        where: { conversationId: conversation.id, leftAt: IsNull() },
      }),
    ]);
    const seated = new Set(
      seats.map((seat) => `${seat.participantSurface}:${seat.userId}`),
    );
    const agencyIds = operators
      .map((row) => row.userId)
      .filter((id): id is string => Boolean(id));
    const identity = await this.identities(scope, [
      ...agencyIds,
      ...memberships.map((row) => row.userId),
    ]);

    const agency = operators
      .filter((row): row is typeof row & { userId: string } =>
        Boolean(row.userId),
      )
      .map((row) => {
        const who = identity.get(row.userId);
        return {
          surface: 'agency' as const,
          userId: row.userId,
          membershipId: null,
          displayName: who?.displayName || row.name || row.email,
          email: row.email || who?.email || null,
          avatarUrl: who?.avatarUrl ?? null,
          isMember: seated.has(`agency:${row.userId}`),
        };
      });
    const client = memberships.map((row) => {
      const who = identity.get(row.userId);
      return {
        surface: 'client_area' as const,
        userId: row.userId,
        membershipId: row.id,
        displayName: who?.displayName || who?.email || 'Usuário do cliente',
        email: who?.email ?? null,
        avatarUrl: who?.avatarUrl ?? null,
        isMember: seated.has(`client_area:${row.userId}`),
      };
    });
    return [...agency, ...client].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, 'pt-BR'),
    );
  }

  /**
   * TC-CL1 — seats people chosen by an Agency manager. Each entry is re-proved
   * against the same rule `listMemberCandidates` shows, so a forged id (an
   * operator of another workspace, a membership of another company) is
   * rejected rather than seated.
   */
  async addParticipants(
    scope: ClientConversationScope,
    conversationId: unknown,
    entries: Array<{ surface: 'agency' | 'client_area'; userId: string }>,
    addedByUserId: string,
  ): Promise<ConversationParticipantView[]> {
    const conversation = await this.findAccessible(scope, conversationId, {
      requireActive: true,
    });
    for (const entry of entries) {
      if (!isUuid(entry.userId)) throw new BadRequestException('Invalid user.');
      if (entry.surface === 'agency') {
        const operator = await this.workspaceUsers.exists({
          where: {
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
            userId: entry.userId,
            status: 'active',
          },
        });
        if (!operator)
          throw new BadRequestException('User is not an active agency user.');
        await this.seatParticipant(conversation, {
          surface: 'agency',
          userId: entry.userId,
          membershipId: null,
          role: 'member',
          addedByUserId,
        });
        continue;
      }
      const membership = await this.memberships.findOne({
        where: {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          companyContextId: scope.companyContextId,
          userId: entry.userId,
          status: 'active',
        },
      });
      if (!membership)
        throw new BadRequestException(
          'User has no active link with this company.',
        );
      await this.seatParticipant(conversation, {
        surface: 'client_area',
        userId: entry.userId,
        membershipId: membership.id,
        role: 'member',
        addedByUserId,
      });
    }
    return this.listParticipants(scope, conversation.id);
  }

  /** TC-CL1 — seats the Agency manager themself (the "start/join" path). */
  async joinAsAgency(
    scope: ClientConversationScope,
    userId: string,
  ): Promise<ClientConversationEntity> {
    await this.assertActorEligible(scope, { surface: 'agency', userId });
    const conversation = await this.ensureConversation(scope);
    const seats = await this.participants.count({
      where: {
        conversationId: conversation.id,
        participantSurface: 'agency',
        leftAt: IsNull(),
      },
    });
    await this.seatParticipant(conversation, {
      surface: 'agency',
      userId,
      membershipId: null,
      // The first Agency seat of a conversation is its owner.
      role: seats === 0 ? 'owner' : 'member',
      addedByUserId: userId,
    });
    return conversation;
  }

  /** TC-CL1 — closes a seat (history stays; the row can be revived later). */
  async removeParticipant(
    scope: ClientConversationScope,
    conversationId: unknown,
    participantId: unknown,
  ): Promise<void> {
    const conversation = await this.findAccessible(scope, conversationId);
    if (!isUuid(participantId)) throw conversationNotFound();
    const participant = await this.participants.findOne({
      where: { id: participantId, conversationId: conversation.id },
    });
    if (!participant || participant.leftAt) throw conversationNotFound();
    await this.participants.update(
      { id: participant.id },
      { leftAt: new Date() },
    );
  }

  /** Live seat user ids of one surface (notification fan-out). */
  async liveUserIds(
    conversationId: string,
    surface: 'agency' | 'client_area',
  ): Promise<string[]> {
    const rows = await this.participants.find({
      where: { conversationId, participantSurface: surface, leftAt: IsNull() },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  private async identities(
    scope: ClientConversationScope,
    userIds: string[],
  ): Promise<
    Map<
      string,
      { displayName: string; email: string | null; avatarUrl: string | null }
    >
  > {
    const ids = [...new Set(userIds)];
    if (!ids.length) return new Map();
    const profiles = await this.profiles.find({
      where: { tenantId: scope.tenantId, userId: In(ids) },
    });
    return new Map(
      profiles.map((row) => [
        row.userId,
        {
          displayName: row.displayName?.trim() ?? '',
          email: row.email?.trim() || null,
          avatarUrl: row.avatarUrl ?? null,
        },
      ]),
    );
  }

  private async project(
    conversation: ClientConversationEntity,
    actor: ConversationActor,
    companyDisplayName: string | null,
  ): Promise<ConversationView> {
    const participant = await this.findParticipant(conversation.id, actor);
    const watermark = participant ? unreadWatermark(participant) : null;

    return {
      id: conversation.id,
      companyContextId: conversation.companyContextId,
      companyDisplayName,
      status: conversation.status,
      lastMessageAt: conversation.lastMessageAt,
      unreadCount: await this.countUnread(conversation.id, watermark),
      lastReadAt: participant?.lastReadAt ?? null,
      title: conversation.title ?? null,
      description: conversation.description ?? null,
      avatarUrl: conversation.avatarUrl ?? null,
      mutedUntil: participant?.mutedUntil ?? null,
    };
  }

  /**
   * Unread = messages after the watermark. A null watermark counts zero, not
   * everything: the Agency chat's `count(*)` fallback is the bug this domain
   * refuses to inherit (CCOM0.5 §7).
   */
  private async countUnread(
    conversationId: string,
    watermark: Date | null,
  ): Promise<number> {
    if (!watermark) return 0;

    return this.messages
      .createQueryBuilder('m')
      .where('m.conversation_id = :conversationId', { conversationId })
      .andWhere('m.created_at > :watermark', { watermark })
      .getCount();
  }

  /**
   * One keyset page of messages, oldest-first in the response (§46).
   *
   * `(created_at, id)` ordering with a composite comparison, never OFFSET:
   * offset re-reads shift when a message arrives mid-scroll, which in a
   * conversation means a line silently skipped. The tuple comparison is also
   * what CCOM2 extends with a `source` discriminator to merge approval
   * comments into the same page without changing the contract.
   */
  async listMessages(
    scope: ClientConversationScope,
    actor: ConversationActor,
    conversationId: unknown,
    query: { limit?: unknown; before?: unknown } = {},
  ): Promise<{
    messages: ConversationMessageView[];
    nextCursor: string | null;
  }> {
    const conversation = await this.findAccessible(scope, conversationId);
    await this.assertActorEligible(scope, actor);
    await this.requireParticipant(conversation, actor);

    return this.pageMessages(conversation.id, query);
  }

  /**
   * One source's window: the `limit + 1` newest messages strictly older than
   * the cursor position (CCOM2 §22).
   *
   * The SQL tuple comparison now carries the source rank as a literal, because
   * `source` sits between the timestamp and the id in the sort key. For this
   * table the rank is constant, so the comparison collapses to:
   *
   *   created_at < cursor.createdAt
   *     OR (created_at = cursor.createdAt AND <rank side> ...)
   *
   * Spelling it out rather than reusing `(created_at, id) < (…)` is what keeps
   * a message and an approval comment sharing one timestamp from being ordered
   * differently by the database than by the merge (§23).
   */
  private async pageMessageWindow(
    conversationId: string,
    limit: number,
    cursor: ClientConversationCursor | null,
  ): Promise<ClientConversationMessageEntity[]> {
    const builder = this.messages
      .createQueryBuilder('m')
      .where('m.conversation_id = :conversationId', {
        conversationId,
      })
      .orderBy('m.created_at', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .take(limit + 1);

    if (cursor) {
      const rank = timelineSourceRank('conversation_message');
      const cursorRank = timelineSourceRank(cursor.source);

      if (rank < cursorRank) {
        // This source sorts before the cursor's source at an equal timestamp,
        // so rows at that exact timestamp are still older.
        builder.andWhere('m.created_at <= :cursorCreatedAt', {
          cursorCreatedAt: cursor.createdAt,
        });
      } else if (rank > cursorRank) {
        builder.andWhere('m.created_at < :cursorCreatedAt', {
          cursorCreatedAt: cursor.createdAt,
        });
      } else {
        builder.andWhere(
          '(m.created_at, m.id) < (:cursorCreatedAt, :cursorId)',
          { cursorCreatedAt: cursor.createdAt, cursorId: cursor.id },
        );
      }
    }

    return builder.getMany();
  }

  /** The keyset page itself, with no authorization and no provisioning. */
  private async pageMessages(
    conversationId: string,
    query: { limit?: unknown; before?: unknown },
  ): Promise<{
    messages: ConversationMessageView[];
    nextCursor: string | null;
  }> {
    const limit = resolveLimit(query.limit);
    const cursor = decodeConversationCursor(query.before);

    const rows = await this.pageMessageWindow(conversationId, limit, cursor);
    const { items, nextCursor } = mergeTimelinePage(
      [
        rows.map((row) => ({
          createdAt: row.createdAt,
          source: 'conversation_message' as const,
          id: row.id,
          row,
        })),
      ],
      limit,
    );

    const attachments = this.attachmentsFor
      ? await this.attachmentsFor(items.map((item) => item.id))
      : new Map<string, ConversationAttachmentView[]>();

    return {
      messages: items.map((item) =>
        toMessageView(item.row, attachments.get(item.id) ?? []),
      ),
      nextCursor,
    };
  }

  /**
   * The message window plus its merged page, for the timeline service (§18).
   *
   * Exposed so `ClientConversationTimelineService` can merge this source with
   * the approval-comment source without reimplementing either the window query
   * or the attachment projection — and without gaining its own copy of the
   * access check, which stays in this service.
   */
  async readMessageWindow(
    conversationId: string,
    limit: number,
    cursor: ClientConversationCursor | null,
  ): Promise<ConversationMessageView[]> {
    const rows = await this.pageMessageWindow(conversationId, limit, cursor);
    const attachments = this.attachmentsFor
      ? await this.attachmentsFor(rows.map((row) => row.id))
      : new Map<string, ConversationAttachmentView[]>();

    return rows.map((row) => toMessageView(row, attachments.get(row.id) ?? []));
  }

  /**
   * Attachment projection, injected by the module rather than constructor-wired.
   *
   * `ClientConversationAttachmentsService` depends on this service to re-prove
   * conversation access, so a constructor dependency the other way would be a
   * cycle. A setter keeps the access primitive in one place — the attachments
   * service must not grow its own copy of the scope check — at the cost of this
   * one explicit wiring step, done once in the module.
   */
  private attachmentsFor:
    | ((
        messageIds: string[],
      ) => Promise<Map<string, ConversationAttachmentView[]>>)
    | null = null;

  registerAttachmentProjection(
    resolver: (
      messageIds: string[],
    ) => Promise<Map<string, ConversationAttachmentView[]>>,
  ): void {
    this.attachmentsFor = resolver;
  }

  /**
   * Appends a message. Writes require an active conversation (§47: append-only,
   * so there is no later correction path to lean on).
   *
   * CCOM2 §42/§50 — no approval rule touches this path. A card is published by
   * `publishCard`, and the two reserved metadata keys (`card`, `dedupeKey`) are
   * stripped from whatever a caller supplies here. The DTO already has no
   * `metadata` field and the global pipe runs `forbidNonWhitelisted`, so a
   * client body carrying one is a 400 before this line — the strip is the second
   * layer, for an internal caller that passes metadata through by mistake.
   * Together with the server-derived `kind`, a client cannot author a card.
   */
  async createMessage(
    scope: ClientConversationScope,
    actor: ConversationActor,
    conversationId: unknown,
    input: {
      body?: unknown;
      kind?: ClientConversationMessageKind;
      metadata?: ClientConversationMessageMetadata | null;
      attachmentIds?: readonly string[];
    },
  ): Promise<ConversationMessageView> {
    const conversation = await this.findAccessible(scope, conversationId, {
      requireActive: true,
    });
    await this.assertActorEligible(scope, actor);
    const participant = await this.requireParticipant(conversation, actor);

    const body = normalizeBody(input.body);
    const attachmentIds = (input.attachmentIds ?? []).filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    // A file with no caption is a legitimate message, so an empty body is only
    // rejected when nothing else carries content.
    const kind = input.kind ?? (attachmentIds.length ? 'attachment' : 'text');

    if (!body && kind === 'text') {
      // `BadRequestException`, not `ForbiddenException` with a 400 body: Nest
      // takes the status from the exception class, so the latter answers 403
      // and tells the caller they lack permission for a message they are
      // entitled to send. The payload is not the status.
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Message body is required.',
        code: CLIENT_CONVERSATION_ERROR_CODES.messageEmpty,
      });
    }

    const saved = await this.messages.save(
      this.messages.create({
        tenantId: conversation.tenantId,
        workspaceId: conversation.workspaceId,
        agencyClientId: conversation.agencyClientId,
        companyContextId: conversation.companyContextId,
        conversationId: conversation.id,
        senderSurface: actor.surface,
        senderUserId: actor.userId,
        body,
        kind,
        metadata: stripReservedMetadata(input.metadata),
      }),
    );

    await this.conversations.update(
      { id: conversation.id },
      { lastMessageAt: saved.createdAt },
    );

    // The author has read what they just wrote; not doing this would make a
    // sender's own message count against them on the next list.
    await this.participants.update(
      { id: participant.id },
      { lastReadAt: saved.createdAt },
    );

    const bound =
      attachmentIds.length && this.bindAttachments
        ? await this.bindAttachments(conversation.id, saved.id, attachmentIds)
        : [];

    return toMessageView(saved, bound);
  }

  private bindAttachments:
    | ((
        conversationId: string,
        messageId: string,
        attachmentIds: readonly string[],
      ) => Promise<ConversationAttachmentView[]>)
    | null = null;

  registerAttachmentBinder(
    binder: (
      conversationId: string,
      messageId: string,
      attachmentIds: readonly string[],
    ) => Promise<ConversationAttachmentView[]>,
  ): void {
    this.bindAttachments = binder;
  }

  /**
   * CCOM2 §6/§9/§10 — publishes a platform card into the company's existing
   * default conversation, idempotently.
   *
   * THIS IS NOT `createMessage` AND MUST NOT BECOME IT
   * -------------------------------------------------
   * `createMessage` is the surface path: it takes an actor, re-proves their
   * eligibility, seats them, and moves their watermark. A card has no human
   * actor, so none of that applies — and routing it through the surface path
   * would mean the platform needed a participant seat, which is the one way a
   * server-side event could invent access for somebody (§10).
   *
   * Four properties, each load-bearing:
   *
   *   author        `sender_surface='agency'` with `sender_user_id = NULL`,
   *                 the only combination the database CHECK allows for an
   *                 authorless row (§6). Attributing the card to the client
   *                 would make the platform speak as them.
   *   kind          `system`, derived here and never from any input (§5).
   *   provisioning  the conversation is *found*, never created. A client who
   *                 has not opened the surface yet has no conversation, and an
   *                 approval transition must not create one and seat them —
   *                 the same rule the preview follows (CCOM1 §14). The card is
   *                 skipped, and the client sees the approval in its own
   *                 module; the card appears once the conversation exists.
   *   dedupe        checked before insert on `metadata->>'dedupeKey'`, so a
   *                 retried event lands once (§9/§51).
   *
   * Returns a status rather than throwing: §10 requires that a failure here
   * never fails the approval transition.
   */
  async publishCard(
    scope: ClientConversationScope,
    card:
      | ClientConversationApprovalCard
      | ClientConversationSettingsRequestCard,
    dedupeKey: string,
  ): Promise<{
    status: 'posted' | 'duplicate' | 'skipped';
    conversationId?: string;
    message?: ConversationMessageView;
  }> {
    return this.publishPlatformLine(
      scope,
      card.kind === 'approval_card'
        ? approvalCardBody(card.title, card.version)
        : card.title,
      { card, dedupeKey },
      dedupeKey,
    );
  }

  /**
   * AR5 — a system line with no card: a decision recorded in the timeline.
   * Same rules as `publishCard`: found, never created, and once per key.
   */
  async publishSystemLine(
    scope: ClientConversationScope,
    body: string,
    metadata: ClientConversationMessageMetadata,
    dedupeKey: string,
  ): Promise<{
    status: 'posted' | 'duplicate' | 'skipped';
    conversationId?: string;
    message?: ConversationMessageView;
  }> {
    return this.publishPlatformLine(
      scope,
      body,
      { ...metadata, dedupeKey },
      dedupeKey,
    );
  }

  private async publishPlatformLine(
    scope: ClientConversationScope,
    body: string,
    metadata: ClientConversationMessageMetadata,
    dedupeKey: string,
  ): Promise<{
    status: 'posted' | 'duplicate' | 'skipped';
    conversationId?: string;
    message?: ConversationMessageView;
  }> {
    const conversation = await this.conversations.findOne({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        kind: 'default',
        status: 'active',
      },
    });

    if (!conversation) return { status: 'skipped' };

    const existing = await this.messages
      .createQueryBuilder('m')
      .where('m.conversation_id = :conversationId', {
        conversationId: conversation.id,
      })
      .andWhere("m.metadata ->> 'dedupeKey' = :dedupeKey", { dedupeKey })
      .getOne();

    if (existing) {
      return {
        status: 'duplicate',
        conversationId: conversation.id,
        message: toMessageView(existing),
      };
    }

    let saved: ClientConversationMessageEntity;
    try {
      saved = await this.messages.save(
        this.messages.create({
          // AR5 — derived from the key, so two publications racing past the
          // check above collide on the primary key instead of both landing.
          id: messageIdForDedupeKey(dedupeKey),
          tenantId: conversation.tenantId,
          workspaceId: conversation.workspaceId,
          agencyClientId: conversation.agencyClientId,
          companyContextId: conversation.companyContextId,
          conversationId: conversation.id,
          senderSurface: 'agency',
          senderUserId: null,
          body,
          kind: 'system',
          metadata,
        }),
      );
    } catch (error) {
      if ((error as { code?: string })?.code === '23505')
        return { status: 'duplicate', conversationId: conversation.id };
      throw error;
    }

    await this.conversations.update(
      { id: conversation.id },
      { lastMessageAt: saved.createdAt },
    );

    return {
      status: 'posted',
      conversationId: conversation.id,
      message: toMessageView(saved),
    };
  }

  /**
   * OR7 — the Orion's answer to a mention, as an authorless Agency text.
   *
   * Like `publishCard`, not `createMessage`: there is no human actor, so no
   * seat and no watermark move. Unlike a card, the conversation is the one the
   * mention was written in, re-proved against the scope (a conversation of
   * another company answers 404) and required active. `sender_user_id = NULL`
   * with `sender_surface = 'agency'` is the authorless combination the CHECK
   * allows; `metadata.assistant` is what the surfaces label as the automatic
   * reply, and it is a reserved key no surface write can carry.
   */
  async publishAssistantReply(
    scope: ClientConversationScope,
    conversationId: unknown,
    input: { body: string; replyToMessageId: string; dedupeKey: string },
  ): Promise<{
    status: 'posted' | 'duplicate';
    message: ConversationMessageView;
  }> {
    const conversation = await this.findAccessible(scope, conversationId, {
      requireActive: true,
    });

    const existing = await this.messages
      .createQueryBuilder('m')
      .where('m.conversation_id = :conversationId', {
        conversationId: conversation.id,
      })
      .andWhere("m.metadata ->> 'dedupeKey' = :dedupeKey", {
        dedupeKey: input.dedupeKey,
      })
      .getOne();
    if (existing)
      return { status: 'duplicate', message: toMessageView(existing) };

    const body = normalizeBody(input.body);
    if (!body) throw new BadRequestException('Reply body is required.');

    const saved = await this.messages.save(
      this.messages.create({
        tenantId: conversation.tenantId,
        workspaceId: conversation.workspaceId,
        agencyClientId: conversation.agencyClientId,
        companyContextId: conversation.companyContextId,
        conversationId: conversation.id,
        senderSurface: 'agency',
        senderUserId: null,
        body,
        kind: 'text',
        metadata: {
          assistant: 'orion',
          replyToMessageId: input.replyToMessageId,
          dedupeKey: input.dedupeKey,
        },
      }),
    );

    await this.conversations.update(
      { id: conversation.id },
      { lastMessageAt: saved.createdAt },
    );

    return { status: 'posted', message: toMessageView(saved) };
  }

  /** The company's active default conversation id, or null. For broadcasts. */
  async findDefaultConversationId(
    scope: ClientConversationScope,
  ): Promise<string | null> {
    const conversation = await this.conversations.findOne({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        kind: 'default',
        status: 'active',
      },
      select: { id: true },
    });
    return conversation?.id ?? null;
  }

  /** Moves the actor's watermark to now (§44). */
  async markRead(
    scope: ClientConversationScope,
    actor: ConversationActor,
    conversationId: unknown,
  ): Promise<{ lastReadAt: Date; unreadCount: number }> {
    const conversation = await this.findAccessible(scope, conversationId);
    await this.assertActorEligible(scope, actor);
    const participant = await this.requireParticipant(conversation, actor);

    const lastReadAt = new Date();
    await this.participants.update({ id: participant.id }, { lastReadAt });

    return { lastReadAt, unreadCount: 0 };
  }

  /**
   * The company's default conversation if it already exists, creating nothing.
   *
   * For the Agency support preview (§48), which must not provision: calling
   * `ensureDefaultConversation` there would mean an operator *looking* at a
   * preview creates a conversation and seats the client in it. A company that
   * has never been written to previews as an empty thread — which is precisely
   * what the client sees today.
   */
  async findDefaultIfExists(
    scope: ClientConversationScope,
  ): Promise<ConversationView | null> {
    const conversation = await this.conversations.findOne({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        kind: 'default',
        status: 'active',
      },
    });

    if (!conversation) return null;

    return {
      id: conversation.id,
      companyContextId: conversation.companyContextId,
      companyDisplayName: null,
      status: conversation.status,
      lastMessageAt: conversation.lastMessageAt,
      // The preview shows the thread, not a client's personal badge: an
      // operator's reading must never move or report someone else's watermark.
      unreadCount: 0,
      lastReadAt: null,
      title: conversation.title ?? null,
      description: conversation.description ?? null,
      avatarUrl: conversation.avatarUrl ?? null,
      mutedUntil: null,
    };
  }

  /**
   * One page of messages with no provisioning and no read-state write.
   *
   * Used only by the preview. The conversation is still re-proved against the
   * scope the preview resolved, so the read is as scoped as any other; what is
   * skipped is creating a seat and touching `last_read_at`.
   */
  async readMessagesWithoutProvisioning(
    scope: ClientConversationScope,
    conversationId: unknown,
    query: { limit?: unknown; before?: unknown } = {},
  ): Promise<{
    messages: ConversationMessageView[];
    nextCursor: string | null;
  }> {
    await this.findAccessible(scope, conversationId);
    return this.pageMessages(String(conversationId), query);
  }

  /**
   * Live participants of a conversation, for realtime fan-out and nothing else.
   * Deliberately not exposed to any surface: it would name agency operators to
   * a client, which the AP3 projection is careful never to do.
   */
  listLiveParticipants(conversationId: string) {
    return this.participants.find({
      where: { conversationId, leftAt: IsNull() },
    });
  }
}

function resolveLimit(value: unknown): number {
  const parsed = Number(value ?? DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_PAGE_SIZE);
}

/**
 * CCOM2 §50 — removes the platform-only metadata keys from a surface write.
 *
 * `card` and `dedupeKey` are written by `publishCard` alone. Returning `null`
 * when nothing else remains keeps the column shaped as CCOM1 left it (no empty
 * objects in rows that carry no metadata).
 */
const RESERVED_METADATA_KEYS: ReadonlySet<string> = new Set([
  'card',
  'dedupeKey',
  // OR7 — the Orion reply marker, written by `publishAssistantReply` alone.
  'assistant',
  'replyToMessageId',
  // AR5 — the decision line, written by `publishSystemLine` alone.
  'decision',
]);

function messageIdForDedupeKey(dedupeKey: string): string {
  const hex = createHash('md5').update(dedupeKey).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stripReservedMetadata(
  metadata: ClientConversationMessageMetadata | null | undefined,
): ClientConversationMessageMetadata | null {
  if (!metadata || typeof metadata !== 'object') return null;

  // Built by keeping, not by deleting: a reserved key added later is excluded
  // by adding it to the set above, and nothing is carried over by default.
  const kept = Object.fromEntries(
    Object.entries(metadata).filter(
      ([key]) => !RESERVED_METADATA_KEYS.has(key),
    ),
  );
  return Object.keys(kept).length > 0 ? kept : null;
}

function normalizeBody(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_BODY_LENGTH);
}

function toMessageView(
  row: ClientConversationMessageEntity,
  attachments: ConversationAttachmentView[] = [],
): ConversationMessageView {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderSurface: row.senderSurface,
    senderUserId: row.senderUserId,
    body: row.body,
    kind: row.kind,
    metadata: row.metadata,
    createdAt: row.createdAt,
    attachments,
    source: 'conversation_message',
  };
}

export { toMessageView };
