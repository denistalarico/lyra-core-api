import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
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
import { ApprovalClientReviewService } from '../approval-client-review.service';
import { ClientApprovalMediaService } from './client-approval-media.service';
import {
  ClientApprovalCommentDto,
  ClientApprovalRequestChangesDto,
} from './client-approval.dto';
import { ClientApprovalsService } from './client-approvals.service';
import { buildClientApprovalListItem } from './client-approval.view';

/**
 * AP3 — the Client Area approvals boundary.
 *
 * Separate from `SocialApprovalsController` on purpose. That one authenticates
 * an Agency operator (`JwtAuthGuard` + `PermissionsGuard` + Agency permission
 * keys) and returns whole entities; this one authenticates a real client
 * person and returns a projection built field by field.
 *
 * AUTHORIZATION, IN THIS ORDER, ON EVERY ROUTE
 * --------------------------------------------
 *   ClientAreaEnabledGuard     surface flag; off ⇒ 404, not a hidden button
 *   ClientAreaAuthGuard        Client Area JWT + live session + not an operator
 *   ClientAreaMembershipGuard  membership, company, org, client, CRM chain
 *   @RequireClientAreaModule   `approvals` entitlement of the managed tenant
 *   @RequireClientAreaPermission  the role preset's key
 *
 * The company always comes from the path and is authoritative only after the
 * membership matches it; no body or header is ever consulted. The scope handed
 * to the domain is `toCompanyAwareScope(ClientAreaContext)` — never
 * `resolveCompanyAwareScope(RequestContext)`, which carries Agency operator
 * and managed-context semantics.
 *
 * The actor of every mutation is `ctx.userId` (the real person). The
 * membership is evidence of authorization and never an actor (CA0 §S).
 */
@Controller('client-area/companies/:companyContextId/approvals')
@UseGuards(
  ClientAreaEnabledGuard,
  ClientAreaAuthGuard,
  ClientAreaMembershipGuard,
)
@RequireClientAreaModule('approvals')
export class ClientAreaApprovalsController {
  constructor(
    private readonly approvals: ClientApprovalsService,
    private readonly review: ApprovalClientReviewService,
    private readonly media: ClientApprovalMediaService,
    private readonly files: FilesService,
  ) {}

  private reader(context: ClientAreaContext) {
    return {
      userId: context.userId,
      permissions: {
        comment: context.permissions.has('client_area.approvals.comment'),
        decide: context.permissions.has('client_area.approvals.decide'),
      },
    };
  }

  @Get()
  @RequireClientAreaPermission('client_area.approvals.view')
  list(@ClientAreaContextData() context: ClientAreaContext) {
    return this.approvals.list(toCompanyAwareScope(context));
  }

  @Get(':approvalId')
  @RequireClientAreaPermission('client_area.approvals.view')
  detail(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
  ) {
    return this.approvals.detail(
      toCompanyAwareScope(context),
      approvalId,
      this.reader(context),
    );
  }

  @Get(':approvalId/preview')
  @RequireClientAreaPermission('client_area.approvals.view')
  async preview(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
  ) {
    return {
      preview: await this.approvals.preview(
        toCompanyAwareScope(context),
        approvalId,
      ),
    };
  }

  /**
   * §18/§19 — an explicit view record, not a side effect of `GET`. It moves no
   * status, creates no decision and approves nothing; it only stamps first/last
   * seen and the viewer, through the existing AP2 mechanism.
   */
  @Post(':approvalId/view')
  @RequireClientAreaPermission('client_area.approvals.view')
  async view(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
  ) {
    const scope = toCompanyAwareScope(context);
    // Proves visibility with the client rule (scope + sent phase) before the
    // domain method, whose own guard is the Agency scope tuple alone.
    await this.approvals.findVisible(scope, approvalId);
    const saved = await this.review.view(scope, approvalId, context.userId);
    return { approval: buildClientApprovalListItem(saved) };
  }

  @Post(':approvalId/comments')
  @RequireClientAreaPermission('client_area.approvals.comment')
  async comment(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Body() dto: ClientApprovalCommentDto,
  ) {
    const scope = toCompanyAwareScope(context);
    await this.approvals.findVisible(scope, approvalId);
    await this.review.comment(scope, approvalId, context.userId, dto.body);
    // The whole thread comes back projected, so the client never sees the
    // raw comment row that the domain returns.
    return this.approvals.detail(scope, approvalId, this.reader(context));
  }

  @Post(':approvalId/approve')
  @RequireClientAreaPermission('client_area.approvals.decide')
  async approve(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
  ) {
    const scope = toCompanyAwareScope(context);
    await this.approvals.findVisible(scope, approvalId);
    await this.review.approve(scope, approvalId, context.userId);
    return this.approvals.detail(scope, approvalId, this.reader(context));
  }

  @Post(':approvalId/request-changes')
  @RequireClientAreaPermission('client_area.approvals.decide')
  async requestChanges(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Body() dto: ClientApprovalRequestChangesDto,
  ) {
    const scope = toCompanyAwareScope(context);
    await this.approvals.findVisible(scope, approvalId);
    await this.review.requestChanges(
      scope,
      approvalId,
      context.userId,
      dto.body,
    );
    return this.approvals.detail(scope, approvalId, this.reader(context));
  }

  /**
   * §26–§28 — bytes, never a location. `mediaRef` is an opaque slot name
   * ("content"/"thumbnail") resolved against this approval's immutable
   * revision; no storage key, bucket, internal host or signed URL is emitted,
   * so there is nothing to tamper with and no link that outlives the request.
   */
  @Get(':approvalId/media/:mediaRef')
  @RequireClientAreaPermission('client_area.approvals.view')
  async mediaContent(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Param('mediaRef') mediaRef: string,
    @Res() response: Response,
  ) {
    const media = await this.media.resolve(
      toCompanyAwareScope(context),
      approvalId,
      mediaRef,
    );
    const file = await this.files.getPrivateAsset(media.storagePath);
    response.setHeader('Content-Type', media.mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    file.body.pipe(response);
  }
}
