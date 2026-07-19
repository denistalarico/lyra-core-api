import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../../permissions';
import { TestInboundMessageDto } from './dto/test-inbound-message.dto';
import { InboundMessageIngestionService } from './services/inbound-message-ingestion.service';
import { SimulateAgentActivationDto } from '../dto/simulate-agent-activation.dto';
import { AgentActivationPolicyService } from '../services/agent-activation-policy.service';
import { LeadFlowAgentBindingReconcilerService } from '../../leadflow-agents/services/leadflow-agent-binding-reconciler.service';
import { ReconcileDefaultBindingDto } from './dto/reconcile-default-binding.dto';

@Controller('inbox/channels')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class InboxChannelsController {
  constructor(
    private readonly inboundIngestionService: InboundMessageIngestionService,
    private readonly activationPolicyService: AgentActivationPolicyService,
    private readonly bindingReconciler: LeadFlowAgentBindingReconcilerService,
  ) {}

  @Post('bindings/reconcile')
  @RequirePermission('leadflow.channels.channel.update.admin')
  reconcileDefaultBinding(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: ReconcileDefaultBindingDto,
  ) {
    return this.bindingReconciler.reconcile(ctx, {
      channelId: dto.channelId,
      preferredAgentId: dto.defaultAgentId,
      trigger: dto.defaultAgentId ? 'default_changed' : 'admin_check',
      requireChoice: true,
    });
  }

  @Post('test-inbound')
  @RequirePermission('leadflow.channels.channel.update.admin')
  async testInbound(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: TestInboundMessageDto,
  ) {
    const { tenantId, workspaceId } = ctx;

    if (!tenantId || !workspaceId) {
      throw new BadRequestException(
        'Tenant and workspace context are required.',
      );
    }

    const result = await this.inboundIngestionService.ingest({
      tenantId,
      workspaceId,
      channelId: dto.channelId,
      channelType: dto.channelType,
      provider: dto.provider ?? null,
      externalThreadId: dto.externalThreadId,
      externalMessageId: dto.externalMessageId ?? null,
      sender: dto.sender,
      messageType: dto.messageType,
      content: dto.content,
      attachments: dto.attachments ?? [],
      occurredAt: new Date(),
      rawPayload: dto.rawPayload ?? {
        source: 'test-inbound-endpoint',
      },
      metadata: dto.metadata ?? {},
    });

    return {
      ok: true,
      conversationId: result.conversation.id,
      messageId: result.message.id,
    };
  }

  @Post('activation/simulate')
  @RequirePermission('leadflow.agents.runtime.preview.admin')
  async simulateActivation(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SimulateAgentActivationDto,
  ) {
    if (!ctx.workspaceId)
      throw new BadRequestException('Workspace context is required.');
    return this.activationPolicyService.evaluate({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      channelId: dto.channelId,
      messageText: dto.messageText,
      conversationState: dto.conversationState,
      internalContact: dto.internalContact,
      duplicate: dto.duplicate,
      qualificationStatus: dto.qualificationStatus,
      referralTrusted: dto.referralTrusted,
      referral: dto.referral,
    });
  }
}
