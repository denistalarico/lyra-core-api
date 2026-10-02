import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { FilesService } from '../../../common/files/files.service';
import {
  ClientAreaContextData,
  RequireClientAreaModule,
  RequireClientAreaPermission,
} from '../../client-area/client-area.decorators';
import { toCompanyAwareScope } from '../../client-area/client-area-scope';
import type { ClientAreaContext } from '../../client-area/client-area.types';
import {
  ClientAreaAuthGuard,
  ClientAreaEnabledGuard,
  ClientAreaMembershipGuard,
} from '../../client-area/guards/client-area.guards';
import { ClientConversationAttachmentsService } from '../services/client-conversation-attachments.service';
import { ClientConversationsService } from '../services/client-conversations.service';
import { ClientConversationTimelineService } from '../services/client-conversation-timeline.service';
import { toConversationScope } from '../services/client-conversation-access';
import { ClientConversationsGateway } from '../gateways/client-conversations.gateway';
import { AgencyClientConversationsGateway } from '../gateways/agency-client-conversations.gateway';
import { SendClientConversationMessageDto } from '../dto/client-conversation.dto';

/**
 * CCOM1 — the Client Area conversations boundary (§22–§24).
 *
 * AUTHORIZATION, IN THIS ORDER, ON EVERY ROUTE
 * --------------------------------------------
 *   ClientAreaEnabledGuard        surface flag; off ⇒ 404, not a hidden button
 *   ClientAreaAuthGuard           Client Area JWT + live session + not operator
 *   ClientAreaMembershipGuard     membership, company, org, client, CRM chain
 *   @RequireClientAreaModule      `conversations` enabled for this company
 *   @RequireClientAreaPermission  the role preset's key (view vs send)
 *
 * The company always comes from the path and becomes authoritative only after
 * a membership matches it; no body or header is ever consulted (§24). The scope
 * handed to the domain is `toCompanyAwareScope(ClientAreaContext)` — the single
 * permitted bridge — never `resolveCompanyAwareScope(RequestContext)`, which
 * carries Agency operator and managed-context semantics.
 *
 * The actor of every write is `context.userId`, the real person; `membershipId`
 * travels as evidence of authorization and is never an actor (CA0 §S).
 */
@Controller('client-area/companies/:companyContextId/conversations')
@UseGuards(
  ClientAreaEnabledGuard,
  ClientAreaAuthGuard,
  ClientAreaMembershipGuard,
)
@RequireClientAreaModule('conversations')
export class ClientAreaConversationsController {
  constructor(
    private readonly conversations: ClientConversationsService,
    private readonly timelineService: ClientConversationTimelineService,
    private readonly attachments: ClientConversationAttachmentsService,
    private readonly files: FilesService,
    private readonly clientRealtime: ClientConversationsGateway,
    private readonly agencyRealtime: AgencyClientConversationsGateway,
  ) {}

  private scope(context: ClientAreaContext) {
    return toConversationScope(toCompanyAwareScope(context));
  }

  private actor(context: ClientAreaContext) {
    return {
      surface: 'client_area' as const,
      userId: context.userId,
      membershipId: context.membershipId,
    };
  }

  @Get()
  @RequireClientAreaPermission('client_area.conversations.view')
  async list(@ClientAreaContextData() context: ClientAreaContext) {
    return {
      conversations: await this.conversations.list(
        this.scope(context),
        this.actor(context),
        context.companyDisplayName,
      ),
    };
  }

  @Get(':conversationId')
  @RequireClientAreaPermission('client_area.conversations.view')
  async detail(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('conversationId') conversationId: string,
  ) {
    return {
      conversation: await this.conversations.detail(
        this.scope(context),
        this.actor(context),
        conversationId,
        context.companyDisplayName,
      ),
    };
  }

  @Get(':conversationId/messages')
  @RequireClientAreaPermission('client_area.conversations.view')
  messages(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.conversations.listMessages(
      this.scope(context),
      this.actor(context),
      conversationId,
      { limit, before },
    );
  }

  /**
   * CCOM2 §18 — the cross-source timeline: this conversation's messages (cards
   * included) merged with the client-visible comments of its company's
   * approvals.
   *
   * A route of its own rather than a widening of `/messages`, for one concrete
   * reason: `/messages` returns `{ messages, nextCursor }` and its cursor is a
   * message keyset, which open clients still hold. The timeline returns a
   * discriminated union and a three-part cursor. Serving both from one path
   * would mean a response shape that depends on a query flag — and a client
   * that guessed wrong would silently render half a conversation.
   *
   * Authorization is unchanged and not re-derived: the same guard chain, the
   * same `conversations.view` key, the same company from the path. The
   * approvals permissions travel into the page only as the reader's *current*
   * ability to act on a card (§13) — they gate actions, never visibility of
   * the conversation.
   */
  @Get(':conversationId/timeline')
  @RequireClientAreaPermission('client_area.conversations.view')
  async timeline(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const scope = this.scope(context);
    // Re-proves the conversation against the company and seats the actor, the
    // same way `/messages` does — the timeline must not be a path that reads
    // without the access check its sibling performs.
    const conversation = await this.conversations.detail(
      scope,
      this.actor(context),
      conversationId,
      context.companyDisplayName,
    );

    return this.timelineService.page(
      scope,
      conversation.id,
      {
        userId: context.userId,
        /**
         * §14 — the **approvals** module decides whether a card is actionable,
         * not the conversations module this route lives under. A client with
         * conversations on and approvals off still sees the card as a record of
         * what was sent, with no action that would 403 on click.
         */
        approvalsModuleEnabled: context.modules.approvals,
        permissions: {
          comment: context.permissions.has('client_area.approvals.comment'),
          decide: context.permissions.has('client_area.approvals.decide'),
        },
      },
      { limit, before },
    );
  }

  @Post(':conversationId/messages')
  @RequireClientAreaPermission('client_area.conversations.send')
  async send(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendClientConversationMessageDto,
  ) {
    const scope = this.scope(context);
    const message = await this.conversations.createMessage(
      scope,
      this.actor(context),
      conversationId,
      { body: dto.body, attachmentIds: dto.attachmentIds },
    );

    // Both surfaces watching this conversation learn about it; the rooms are
    // separate, so this is two explicit emits rather than one shared room.
    this.broadcast(scope, message.conversationId, message);
    return { message };
  }

  @Post(':conversationId/read')
  @RequireClientAreaPermission('client_area.conversations.view')
  async read(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('conversationId') conversationId: string,
  ) {
    const scope = this.scope(context);
    const state = await this.conversations.markRead(
      scope,
      this.actor(context),
      conversationId,
    );

    const payload = {
      tenantId: scope.tenantId,
      companyContextId: scope.companyContextId,
      conversationId,
      surface: 'client_area',
      userId: context.userId,
      lastReadAt: state.lastReadAt,
    };
    this.clientRealtime.broadcastReadUpdated(payload);
    this.agencyRealtime.broadcastReadUpdated(payload);

    return state;
  }

  /**
   * Uploads a file and returns only its opaque ref (§14/§15).
   *
   * `sendMessage` then cites that ref. Nothing in the response names a bucket,
   * a host or a storage key, so there is no URL to leak and no link that
   * outlives the session — the AP3 property this domain is built to inherit.
   */
  @Post(':conversationId/attachments')
  @RequireClientAreaPermission('client_area.conversations.send')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('conversationId') conversationId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return {
      attachment: await this.attachments.upload(
        this.scope(context),
        this.actor(context),
        conversationId,
        file,
      ),
    };
  }

  /**
   * Streams bytes for an opaque ref. The storage path is re-derived from the
   * row after the row's own conversation is re-proved against this request's
   * company, so a ref from another company answers 404 (§16/§53).
   */
  @Get(':conversationId/attachments/:attachmentId')
  @RequireClientAreaPermission('client_area.conversations.view')
  async stream(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('attachmentId') attachmentId: string,
    @Res() response: Response,
  ) {
    const resolved = await this.attachments.resolveForStream(
      this.scope(context),
      this.actor(context),
      attachmentId,
    );

    const file = await this.files.getPrivateAsset(resolved.storageKey);
    response.setHeader('Content-Type', resolved.mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // Never inline: an uploaded document rendered in-origin would be an XSS
    // vector, which is why Team Chat sets the same header on its own assets.
    response.setHeader('Content-Disposition', 'attachment');
    file.body.pipe(response);
  }

  private broadcast(
    scope: { tenantId: string; companyContextId: string },
    conversationId: string,
    message: unknown,
  ) {
    const payload = {
      tenantId: scope.tenantId,
      companyContextId: scope.companyContextId,
      conversationId,
      message,
    };
    this.clientRealtime.broadcastMessageCreated(payload);
    this.agencyRealtime.broadcastMessageCreated(payload);
  }
}
