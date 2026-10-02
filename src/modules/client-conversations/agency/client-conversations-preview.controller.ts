import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser } from '../../auth/decorators/authenticated-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthTokenPayload } from '../../auth/types/auth-token-payload.type';
import { CLIENT_AREA_MANAGE_PERMISSION } from '../../client-area/agency/client-area-management.agency.controller';
import { ClientAreaManagementService } from '../../client-area/services/client-area-management.service';
import {
  PermissionsGuard,
  RequireClientAccess,
  RequirePermission,
} from '../../permissions';
import { ClientConversationsService } from '../services/client-conversations.service';
import { ClientConversationTimelineService } from '../services/client-conversation-timeline.service';

/**
 * CCOM1 §48–§49 — conversations inside the Agency support preview.
 *
 * WHY A SEPARATE CONTROLLER
 * -------------------------
 * The actor is the Agency operator, proven by the Agency JWT,
 * `agency.client_area.manage.admin` and `RequireClientAccess()`. No Client Area
 * token is issued, accepted or reused, and the target client person is never
 * the actor of anything. This mirrors `ClientAreaApprovalsPreviewController`
 * exactly, which is the point: one preview pattern, not two.
 *
 * WHY IT IS STRUCTURALLY READ-ONLY
 * --------------------------------
 * Only `@Get` handlers exist, and mutation is unreachable by construction
 * rather than by policy: every client-side write in this domain requires a
 * `ClientAreaContext`, which only `ClientAreaMembershipGuard` attaches, and
 * that guard runs solely on `/client-area/*` behind a Client Area JWT an
 * operator cannot mint. There is no "don't call this" rule to forget.
 *
 * ONE IMPORTANT DIFFERENCE FROM THE REAL SURFACES
 * -----------------------------------------------
 * The preview must NOT provision anything. The live boundaries call
 * `ensureDefaultConversation`, which creates the conversation and a participant
 * row on first touch; doing that here would mean an operator opening a preview
 * silently creates a conversation and seats *the client* in it — state created
 * by looking. So this controller reads only, and a company whose conversation
 * does not exist yet previews as an empty thread, which is exactly what the
 * client would currently see.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission(CLIENT_AREA_MANAGE_PERMISSION)
@Controller(
  'agency/client-area-management/clients/:clientId/companies/:companyContextId/preview/:membershipId/conversations',
)
export class ClientAreaConversationsPreviewController {
  constructor(
    private readonly management: ClientAreaManagementService,
    private readonly conversations: ClientConversationsService,
    private readonly timelineService: ClientConversationTimelineService,
  ) {}

  /**
   * Re-validates membership, company, Agency app and the CRM chain on every
   * call, and reads the *target membership's* own module availability — so a
   * company without `conversations` 403s and a revoked membership fails the
   * very next request.
   */
  private async resolve(
    user: AuthTokenPayload,
    clientId: string,
    companyContextId: string,
    membershipId: string,
  ) {
    const resolved = await this.management.previewModuleScope(
      user.tenantId,
      user.workspaceId,
      clientId,
      companyContextId,
      membershipId,
    );

    if (!resolved.modules.conversations) {
      throw new ForbiddenException(
        'This module is not available for the company.',
      );
    }

    return {
      scope: resolved.scope,
      /**
       * The target client person, used only so the projection can mark which
       * messages are theirs. Nothing is ever written, so this is never an
       * actor — the same rule the approvals preview states.
       */
      actor: {
        surface: 'client_area' as const,
        userId: resolved.membership.userId,
        membershipId: resolved.membership.id,
      },
      /**
       * CCOM2 — the target membership's *own* module availability and
       * permissions, so the preview renders that person's real card rather than
       * the operator's. Read fresh on every call, like everything else here.
       */
      modules: resolved.modules,
      permissions: resolved.permissions,
    };
  }

  @Get()
  @RequireClientAccess()
  async list(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('companyContextId') companyContextId: string,
    @Param('membershipId') membershipId: string,
  ) {
    const { scope } = await this.resolve(
      user,
      clientId,
      companyContextId,
      membershipId,
    );

    const conversation = await this.conversations.findDefaultIfExists(scope);
    return { conversations: conversation ? [conversation] : [] };
  }

  /**
   * CCOM2 §37/§38 — the preview's cross-source timeline.
   *
   * Shows cards and client-visible approval comments, opens the drawer, and
   * decides nothing. Read-only is still *structural*, not a flag on this
   * route: the timeline page is built by the same service the live surfaces
   * use, but every write in this domain needs a `ClientAreaContext` that only
   * `ClientAreaMembershipGuard` attaches, and that guard never runs here.
   *
   * It also provisions nothing. `findDefaultIfExists` is what resolves the
   * conversation on the sibling route; this one re-proves an id against the
   * preview's scope and reads, so an operator *looking* at a preview never
   * creates a conversation, a participant seat, or a card.
   *
   * The reader's approval permissions are read from the target membership's
   * own preset, like the approvals preview does — so a viewer's preview shows a
   * viewer's card. Both flags are then irrelevant to safety here, because the
   * action routes are unreachable for an Agency token; they exist so the
   * operator sees the client's real affordances.
   */
  @Get(':conversationId/timeline')
  @RequireClientAccess()
  async timeline(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('companyContextId') companyContextId: string,
    @Param('membershipId') membershipId: string,
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const { scope, actor, modules, permissions } = await this.resolve(
      user,
      clientId,
      companyContextId,
      membershipId,
    );

    // Re-proves the conversation against the preview's scope without seating
    // anyone — `findAccessible`, never `ensureDefaultConversation`.
    const conversation = await this.conversations.findAccessible(
      scope,
      conversationId,
    );

    return this.timelineService.page(
      scope,
      conversation.id,
      {
        // The target client person, so their own comments align as theirs in
        // the operator's view. Never an actor: nothing is written.
        userId: actor.userId,
        approvalsModuleEnabled: modules.approvals,
        permissions: {
          comment: permissions.has('client_area.approvals.comment'),
          decide: permissions.has('client_area.approvals.decide'),
        },
      },
      { limit, before },
    );
  }

  @Get(':conversationId/messages')
  @RequireClientAccess()
  async messages(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('companyContextId') companyContextId: string,
    @Param('membershipId') membershipId: string,
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const { scope } = await this.resolve(
      user,
      clientId,
      companyContextId,
      membershipId,
    );

    return this.conversations.readMessagesWithoutProvisioning(
      scope,
      conversationId,
      { limit, before },
    );
  }
}
