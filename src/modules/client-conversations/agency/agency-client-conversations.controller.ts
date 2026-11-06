import { Optional } from '@nestjs/common';
import { CompanyLogoRegistry } from '../../../common/client-area-bridge/company-logo.registry';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FilesService } from '../../../common/files/files.service';
import { AuthenticatedUser } from '../../auth/decorators/authenticated-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthTokenPayload } from '../../auth/types/auth-token-payload.type';
import { ContactEntity } from '../../contacts/entities/contact.entity';
import { PermissionsGuard, RequirePermission } from '../../permissions';
import { AgencyClientConversationAccessService } from '../services/agency-client-conversation-access.service';
import { ClientConversationAttachmentsService } from '../services/client-conversation-attachments.service';
import { ClientConversationsService } from '../services/client-conversations.service';
import { ClientConversationTimelineService } from '../services/client-conversation-timeline.service';
import { ClientConversationsGateway } from '../gateways/client-conversations.gateway';
import { AgencyClientConversationsGateway } from '../gateways/agency-client-conversations.gateway';
import {
  AddClientConversationMembersDto,
  SendClientConversationMessageDto,
  UpdateClientConversationDetailsDto,
  UpdateClientConversationNotificationsDto,
} from '../dto/client-conversation.dto';
import { NotificationRecipientSurface } from '../../notifications/enums';
import { ClientConversationNotificationPublisher } from '../services/client-conversation-notification.publisher';
import {
  ClientConversationAssistantRegistry,
  orionMentionMetadata,
} from '../client-conversation-assistant.port';

const AGENCY_CONNECTION = 'agency';

export const CLIENT_CONVERSATION_VIEW_PERMISSION =
  'agency.client_conversations.view.assigned';
export const CLIENT_CONVERSATION_SEND_PERMISSION =
  'agency.client_conversations.send.assigned';
/**
 * TC-CL1 — starting a client conversation, editing it and choosing its
 * members. The existing Client Area management key (Owner/Admin), checked
 * together with `canAccessClient` by `resolveManageScope`: whoever configures
 * a client's Client Area is who staffs its conversation.
 */
export const CLIENT_CONVERSATION_MANAGE_PERMISSION =
  'agency.client_area.manage.admin';

/**
 * CCOM1 — the Agency boundary for Client Conversations (§27–§29).
 *
 * WHY NEW PERMISSION KEYS RATHER THAN `agency.chat.*`
 * --------------------------------------------------
 * `agency.chat.messages.send.assigned` is held by every role including
 * `member`, and it governs *internal* channels. Reusing it would mean that
 * every operator who can post in `#geral` can also write to a client, with no
 * way to distinguish the two — and the consequence of a mistake differs in
 * kind: an internal misfire is embarrassing, an external one is a leak. So
 * `agency.client_conversations.{view,send}.assigned` are separate keys, granted
 * to the same roles today but revocable on their own.
 *
 * AUTHORIZATION
 * -------------
 *   JwtAuthGuard        Agency access token (no `typ`)
 *   PermissionsGuard    the key above
 *   resolveScope()      company exists + `canAccessClient` + module enabled
 *
 * `canAccessClient` is the platform's existing rule: Owner implied, everyone
 * else needs an `agency_client_access` grant (§29). Knowing a company or
 * conversation UUID grants nothing — the row is fetched and then checked
 * against the scope the operator was proven for, and a mismatch answers 404.
 *
 * Context comes from the JWT here, not from `x-*` headers. The Team Chat
 * controller reads headers (a documented pattern of this repo), but that
 * pattern cost CCOM0.5 a fix in 13 endpoints where a missing `x-user-role`
 * silently downgraded the caller. A boundary that talks to clients starts from
 * the verified token instead.
 */
@Controller('agency/client-conversations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AgencyClientConversationsController {
  constructor(
    @InjectRepository(ContactEntity, AGENCY_CONNECTION)
    private readonly contacts: Repository<ContactEntity>,
    private readonly access: AgencyClientConversationAccessService,
    private readonly conversations: ClientConversationsService,
    private readonly timelineService: ClientConversationTimelineService,
    private readonly attachments: ClientConversationAttachmentsService,
    private readonly files: FilesService,
    private readonly clientRealtime: ClientConversationsGateway,
    private readonly agencyRealtime: AgencyClientConversationsGateway,
    private readonly notificationPublisher: ClientConversationNotificationPublisher,
    private readonly assistants: ClientConversationAssistantRegistry,
    @Optional() private readonly logos?: CompanyLogoRegistry,
  ) {}

  private actorOf(user: AuthTokenPayload) {
    return {
      tenantId: user.tenantId,
      workspaceId: user.workspaceId,
      userId: user.sub,
      role: user.role,
    };
  }

  private participant(user: AuthTokenPayload) {
    return { surface: 'agency' as const, userId: user.sub };
  }

  /**
   * The "Clientes" section of the Team Chat sidebar.
   *
   * Returns the Company Context display name taken from the organization
   * Contact — never `AgencyClient.displayName`, which is the agency's internal
   * commercial label and may differ from what the company is actually called
   * (§40). This is the same source `companyDisplayName()` uses on the client
   * side, so both surfaces name the company identically.
   */
  @Get('companies')
  @RequirePermission(CLIENT_CONVERSATION_VIEW_PERMISSION)
  async companies(@AuthenticatedUser() user: AuthTokenPayload) {
    // TC-CL1 — only companies whose conversation seats this operator.
    const actor = this.actorOf(user);
    // TC-CL1 — an Owner/Admin visit provisions conversations that do not exist
    // yet, so default seats (Owners/Admins + Client Owner) appear as soon as
    // the module is on. Existing conversations and their members are untouched.
    if (user.role === 'owner' || user.role === 'admin') {
      for (const item of await this.access.listEligibleCompanies(actor)) {
        await this.conversations
          .ensureConversation({ ...this.baseScope(actor), ...item })
          .catch(() => undefined);
      }
    }
    const seated = await this.access.listMemberCompanies(actor);
    const companies: Array<Record<string, unknown>> = [];
    for (const entry of await this.decorate(actor, seated)) {
      const scope = { ...this.baseScope(actor), ...entry.scope };
      const [conversation] = await this.conversations.list(
        scope,
        this.participant(user),
        entry.name,
      );
      if (!conversation) continue;
      companies.push({ ...entry.company, conversation });
    }
    return { companies };
  }

  /**
   * TC-CL1 — every company a manager may staff, member or not, for the
   * "start conversation" picker. Reading this provisions nothing.
   */
  @Get('manageable-companies')
  @RequirePermission(CLIENT_CONVERSATION_MANAGE_PERMISSION)
  async manageableCompanies(@AuthenticatedUser() user: AuthTokenPayload) {
    const actor = this.actorOf(user);
    const eligible = await this.access.listEligibleCompanies(actor);
    const seated = new Set(
      (await this.access.listMemberCompanies(actor)).map(
        (item) => item.companyContextId,
      ),
    );
    return {
      companies: (await this.decorate(actor, eligible)).map((entry) => ({
        ...entry.company,
        isMember: seated.has(entry.company.companyContextId),
      })),
    };
  }

  /** TC-CL1 — a manager starts (or rejoins) a company's conversation. */
  @Post('companies/:companyContextId/join')
  @RequirePermission(CLIENT_CONVERSATION_MANAGE_PERMISSION)
  @HttpCode(200)
  async join(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('companyContextId') companyContextId: string,
  ) {
    const actor = this.actorOf(user);
    const scope = await this.access.resolveManageScope(actor, companyContextId);
    await this.conversations.joinAsAgency(scope, user.sub);
    const [entry] = await this.decorate(actor, [
      {
        companyContextId: scope.companyContextId,
        agencyClientId: scope.agencyClientId,
        companyContactId: (
          await this.access.findCompany(actor, scope.companyContextId)
        ).companyContactId,
      },
    ]);
    const [conversation] = await this.conversations.list(
      scope,
      this.participant(user),
      entry.name,
    );
    return { company: { ...entry.company, conversation } };
  }

  @Patch('companies/:companyContextId/conversations/:conversationId')
  @RequirePermission(CLIENT_CONVERSATION_MANAGE_PERMISSION)
  async updateDetails(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('companyContextId') companyContextId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateClientConversationDetailsDto,
  ) {
    const scope = await this.access.resolveManageScope(
      this.actorOf(user),
      companyContextId,
    );
    const row = await this.conversations.updateDetails(
      scope,
      conversationId,
      dto,
    );
    return {
      title: row.title,
      description: row.description,
      avatarUrl: row.avatarUrl,
    };
  }

  /** Members are visible to members (and to managers of the client). */
  @Get('companies/:companyContextId/conversations/:conversationId/members')
  @RequirePermission(CLIENT_CONVERSATION_VIEW_PERMISSION)
  async members(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('companyContextId') companyContextId: string,
    @Param('conversationId') conversationId: string,
  ) {
    const scope = await this.access.resolveScope(
      this.actorOf(user),
      companyContextId,
    );
    await this.conversations.detail(
      scope,
      this.participant(user),
      conversationId,
    );
    return {
      members: await this.conversations.listParticipants(scope, conversationId),
    };
  }

  @Get(
    'companies/:companyContextId/conversations/:conversationId/member-candidates',
  )
  @RequirePermission(CLIENT_CONVERSATION_MANAGE_PERMISSION)
  async memberCandidates(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('companyContextId') companyContextId: string,
    @Param('conversationId') conversationId: string,
  ) {
    const scope = await this.access.resolveManageScope(
      this.actorOf(user),
      companyContextId,
    );
    return {
      candidates: await this.conversations.listMemberCandidates(
        scope,
        conversationId,
      ),
    };
  }

  @Post('companies/:companyContextId/conversations/:conversationId/members')
  @RequirePermission(CLIENT_CONVERSATION_MANAGE_PERMISSION)
  async addMembers(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('companyContextId') companyContextId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: AddClientConversationMembersDto,
  ) {
    const scope = await this.access.resolveManageScope(
      this.actorOf(user),
      companyContextId,
    );
    return {
      members: await this.conversations.addParticipants(
        scope,
        conversationId,
        dto.members,
        user.sub,
      ),
    };
  }

  @Delete(
    'companies/:companyContextId/conversations/:conversationId/members/:participantId',
  )
  @RequirePermission(CLIENT_CONVERSATION_MANAGE_PERMISSION)
  @HttpCode(204)
  async removeMember(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('companyContextId') companyContextId: string,
    @Param('conversationId') conversationId: string,
    @Param('participantId') participantId: string,
  ) {
    const scope = await this.access.resolveManageScope(
      this.actorOf(user),
      companyContextId,
    );
    await this.conversations.removeParticipant(
      scope,
      conversationId,
      participantId,
    );
  }

  @Patch(
    'companies/:companyContextId/conversations/:conversationId/notifications',
  )
  @RequirePermission(CLIENT_CONVERSATION_VIEW_PERMISSION)
  async notifications(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('companyContextId') companyContextId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateClientConversationNotificationsDto,
  ) {
    const scope = await this.access.resolveScope(
      this.actorOf(user),
      companyContextId,
    );
    return this.conversations.setMuted(
      scope,
      this.participant(user),
      conversationId,
      dto.mutedUntil ? new Date(dto.mutedUntil) : null,
    );
  }

  private baseScope(actor: { tenantId: string; workspaceId: string }) {
    return { tenantId: actor.tenantId, workspaceId: actor.workspaceId };
  }

  /**
   * Company display name (organization Contact, never the Agency Client's
   * commercial label — §40) and logo, for a list of eligible companies.
   */
  private async decorate(
    actor: { tenantId: string; workspaceId: string },
    items: Array<{
      companyContextId: string;
      agencyClientId: string;
      companyContactId: string;
    }>,
  ) {
    const contacts = items.length
      ? await this.contacts.find({
          where: items.map((item) => ({
            id: item.companyContactId,
            tenantId: actor.tenantId,
            workspaceId: actor.workspaceId,
          })),
        })
      : [];
    const nameBy = new Map(contacts.map((item) => [item.id, item]));
    const urls = await this.logos?.resolveMany(
      items.map((item) => ({
        tenantId: actor.tenantId,
        workspaceId: actor.workspaceId,
        agencyClientId: item.agencyClientId,
        companyContextId: item.companyContextId,
      })),
    );
    return items.map((item, index) => {
      const contact = nameBy.get(item.companyContactId);
      const name =
        contact?.displayName?.trim() || contact?.legalName?.trim() || 'Empresa';
      return {
        name,
        scope: {
          agencyClientId: item.agencyClientId,
          companyContextId: item.companyContextId,
        },
        company: {
          companyContextId: item.companyContextId,
          agencyClientId: item.agencyClientId,
          displayName: name,
          ...(this.logos ? { companyLogoUrl: urls?.[index] ?? null } : {}),
        },
      };
    });
  }

  @Get('companies/:companyContextId')
  @RequirePermission(CLIENT_CONVERSATION_VIEW_PERMISSION)
  async detail(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('companyContextId') companyContextId: string,
  ) {
    const scope = await this.access.resolveScope(
      this.actorOf(user),
      companyContextId,
    );
    const [conversation] = await this.conversations.list(
      scope,
      this.participant(user),
    );
    return { conversation };
  }

  @Get('companies/:companyContextId/conversations/:conversationId/messages')
  @RequirePermission(CLIENT_CONVERSATION_VIEW_PERMISSION)
  async messages(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('companyContextId') companyContextId: string,
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const scope = await this.access.resolveScope(
      this.actorOf(user),
      companyContextId,
    );
    return this.conversations.listMessages(
      scope,
      this.participant(user),
      conversationId,
      { limit, before },
    );
  }

  /**
   * CCOM2 §35/§36 — the Agency view of the same external timeline.
   *
   * THE SAME PROJECTION, NOT AN AGENCY-FLAVOURED ONE
   * ------------------------------------------------
   * This renders what the client sees: cards and **client-visible** approval
   * comments. Internal approval comments do not appear here, and that is the
   * point rather than an oversight — the "Clientes" section of Team Chat
   * represents the conversation *with the client*, so an operator reading it
   * must see exactly the external record. Internal notes stay where they are
   * written and read, in the Agency approvals UI (§49).
   *
   * NO DECIDE PERMISSIONS, EVER
   * ---------------------------
   * The reader is passed with both approval permissions false, so an Agency
   * card resolves informational: status and a link into the Agency approvals
   * surface, never `Aprovar`/`Pedir alteração`. An operator deciding on the
   * client's behalf is not a UI affordance this product has, and the client
   * decision routes are Client-Area-only by construction anyway (§35) — an
   * operator cannot mint the token they require.
   */
  @Get('companies/:companyContextId/conversations/:conversationId/timeline')
  @RequirePermission(CLIENT_CONVERSATION_VIEW_PERMISSION)
  async timeline(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('companyContextId') companyContextId: string,
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const scope = await this.access.resolveScope(
      this.actorOf(user),
      companyContextId,
    );
    const conversation = await this.conversations.detail(
      scope,
      this.participant(user),
      conversationId,
    );

    return this.timelineService.page(
      scope,
      conversation.id,
      {
        // An Agency user id can never match a client comment's author, so
        // nothing on this timeline is ever marked as the reader's own.
        userId: user.sub,
        // The card resolves and shows its status; `canOpenPreview` follows,
        // and the two action flags below keep it inert.
        approvalsModuleEnabled: true,
        permissions: { comment: false, decide: false },
      },
      { limit, before },
    );
  }

  @Post('companies/:companyContextId/conversations/:conversationId/messages')
  @RequirePermission(CLIENT_CONVERSATION_SEND_PERMISSION)
  async send(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('companyContextId') companyContextId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendClientConversationMessageDto,
  ) {
    const scope = await this.access.resolveScope(
      this.actorOf(user),
      companyContextId,
    );
    const message = await this.conversations.createMessage(
      scope,
      this.participant(user),
      conversationId,
      {
        body: dto.body,
        attachmentIds: dto.attachmentIds,
        metadata: orionMentionMetadata(dto),
      },
    );

    const payload = {
      tenantId: scope.tenantId,
      companyContextId: scope.companyContextId,
      conversationId: message.conversationId,
      message,
    };
    this.clientRealtime.broadcastMessageCreated(payload);
    this.agencyRealtime.broadcastMessageCreated(payload);

    // OR7 — asynchronous; never delays or fails the send.
    this.assistants.schedule({
      author: { surface: 'agency', user: this.actorOf(user) },
      scope,
      message,
    });

    // NTF-C1 §39/§66 — after the message is persisted and broadcast, so a
    // notification failure can never cost the message or the realtime event.
    await this.notificationPublisher.publishMessageCreated({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      companyContextId: scope.companyContextId,
      conversationId: message.conversationId,
      messageId: message.id,
      authorSurface: NotificationRecipientSurface.AGENCY,
      authorUserId: user.sub,
      createdAt: new Date(message.createdAt),
    });

    return { message };
  }

  @Post('companies/:companyContextId/conversations/:conversationId/read')
  @RequirePermission(CLIENT_CONVERSATION_VIEW_PERMISSION)
  async read(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('companyContextId') companyContextId: string,
    @Param('conversationId') conversationId: string,
  ) {
    const scope = await this.access.resolveScope(
      this.actorOf(user),
      companyContextId,
    );
    const state = await this.conversations.markRead(
      scope,
      this.participant(user),
      conversationId,
    );

    const payload = {
      tenantId: scope.tenantId,
      companyContextId: scope.companyContextId,
      conversationId,
      surface: 'agency',
      userId: user.sub,
      lastReadAt: state.lastReadAt,
    };
    this.clientRealtime.broadcastReadUpdated(payload);
    this.agencyRealtime.broadcastReadUpdated(payload);

    return state;
  }

  @Post('companies/:companyContextId/conversations/:conversationId/attachments')
  @RequirePermission(CLIENT_CONVERSATION_SEND_PERMISSION)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('companyContextId') companyContextId: string,
    @Param('conversationId') conversationId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const scope = await this.access.resolveScope(
      this.actorOf(user),
      companyContextId,
    );
    return {
      attachment: await this.attachments.upload(
        scope,
        this.participant(user),
        conversationId,
        file,
      ),
    };
  }

  @Get(
    'companies/:companyContextId/conversations/:conversationId/attachments/:attachmentId',
  )
  @RequirePermission(CLIENT_CONVERSATION_VIEW_PERMISSION)
  async stream(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('companyContextId') companyContextId: string,
    @Param('attachmentId') attachmentId: string,
    @Res() response: Response,
  ) {
    const scope = await this.access.resolveScope(
      this.actorOf(user),
      companyContextId,
    );
    const resolved = await this.attachments.resolveForStream(
      scope,
      this.participant(user),
      attachmentId,
    );

    const file = await this.files.getPrivateAsset(resolved.storageKey);
    response.setHeader('Content-Type', resolved.mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Disposition', 'attachment');
    file.body.pipe(response);
  }
}
