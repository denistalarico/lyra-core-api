import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Raw, Repository } from 'typeorm';
import { FilesService } from '../../common/files/files.service';
import { InboxService } from '../inbox/inbox.service';
import { InboxSettingsService } from '../inbox/inbox-settings.service';
import { ContactsService } from '../contacts/contacts.service';
import type { RequestContext } from '../../common/context/request-context.interface';
import { CreatePublicWebchatConversationDto } from './dto/create-public-webchat-conversation.dto';
import { CreatePublicWebchatMessageDto } from './dto/create-public-webchat-message.dto';
import { CreatePublicWebchatVisitorDto } from './dto/create-public-webchat-visitor.dto';
import { CreateWebchatAdminMessageDto } from './dto/create-webchat-admin-message.dto';
import { CreateWebchatWidgetDto } from './dto/create-webchat-widget.dto';
import { PatchWebchatWidgetDto } from './dto/patch-webchat-widget.dto';
import { WebchatConversationEntity } from './entities/webchat-conversation.entity';
import { WebchatMessageEntity } from './entities/webchat-message.entity';
import { WebchatVisitorEntity } from './entities/webchat-visitor.entity';
import { WebchatWidgetEntity } from './entities/webchat-widget.entity';

type ListWidgetConversationsQuery = {
  status?: string;
  limit?: string;
  offset?: string;
};

@Injectable()
export class WebchatService {
  constructor(
    @InjectRepository(WebchatWidgetEntity)
    private readonly widgetsRepository: Repository<WebchatWidgetEntity>,

    @InjectRepository(WebchatVisitorEntity)
    private readonly visitorsRepository: Repository<WebchatVisitorEntity>,

    @InjectRepository(WebchatConversationEntity)
    private readonly conversationsRepository: Repository<WebchatConversationEntity>,

    @InjectRepository(WebchatMessageEntity)
    private readonly messagesRepository: Repository<WebchatMessageEntity>,
    private readonly inboxService: InboxService,

    private readonly filesService: FilesService,
    private readonly inboxSettingsService: InboxSettingsService,
    private readonly contactsService: ContactsService,
  ) {}

  async listWidgets(ctx: RequestContext) {
    const workspaceId = this.requireWorkspaceId(ctx);

    return this.widgetsRepository.find({
      where: this.withClientScope(ctx, {
        tenantId: ctx.tenantId,
        workspaceId,
      }),
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async createWidget(ctx: RequestContext, dto: CreateWebchatWidgetDto) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const widget = this.widgetsRepository.create({
      tenantId: ctx.tenantId,
      workspaceId,
      name: dto.name.trim(),
      slug: this.slugify(dto.slug ?? dto.name),
      status: dto.status ?? 'draft',
      allowedDomains: this.normalizeDomains(dto.allowedDomains),
      title: dto.title?.trim() || 'Olá! Como podemos ajudar?',
      subtitle: this.optionalString(dto.subtitle),
      initialMessage: this.optionalString(dto.initialMessage),
      primaryColor: dto.primaryColor ?? '#2563EB',
      position: dto.position ?? 'bottom-right',
      defaultLocale: dto.defaultLocale ?? 'pt-BR',
      aiEnabled: dto.aiEnabled ?? false,
      defaultAgentId: dto.defaultAgentId ?? null,
      agentDisplayName: this.optionalString(dto.agentDisplayName),
      agentAvatarUrl: this.optionalString(dto.agentAvatarUrl),
      brandFooterEnabled: dto.brandFooterEnabled ?? true,
      brandFooterText: dto.brandFooterText?.trim() || 'By Lyra Suite',
      leadCaptureEnabled: dto.leadCaptureEnabled ?? false,
      leadCaptureMode: dto.leadCaptureMode ?? 'optional',
      metadata: this.stampContext(ctx, dto.metadata ?? {}),
    });

    return this.widgetsRepository.save(widget);
  }

  async getWidget(ctx: RequestContext, widgetId: string) {
    return this.findWidgetOrFail(ctx, widgetId);
  }

  async patchWidget(
    ctx: RequestContext,
    widgetId: string,
    dto: PatchWebchatWidgetDto,
  ) {
    const widget = await this.findWidgetOrFail(ctx, widgetId);

    if (dto.name !== undefined) widget.name = dto.name.trim();
    if (dto.slug !== undefined) widget.slug = this.slugify(dto.slug);
    if (dto.status !== undefined) widget.status = dto.status;
    if (dto.allowedDomains !== undefined) {
      widget.allowedDomains = this.normalizeDomains(dto.allowedDomains);
    }
    if (dto.title !== undefined) {
      widget.title = dto.title.trim() || 'Olá! Como podemos ajudar?';
    }
    if (dto.subtitle !== undefined)
      widget.subtitle = this.nullableString(dto.subtitle);
    if (dto.initialMessage !== undefined) {
      widget.initialMessage = this.nullableString(dto.initialMessage);
    }
    if (dto.primaryColor !== undefined) widget.primaryColor = dto.primaryColor;
    if (dto.position !== undefined) widget.position = dto.position;
    if (dto.defaultLocale !== undefined)
      widget.defaultLocale = dto.defaultLocale;
    if (dto.aiEnabled !== undefined) widget.aiEnabled = dto.aiEnabled;
    if (dto.defaultAgentId !== undefined)
      widget.defaultAgentId = dto.defaultAgentId;
    if (dto.agentDisplayName !== undefined) {
      widget.agentDisplayName = this.nullableString(dto.agentDisplayName);
    }
    if (dto.agentAvatarUrl !== undefined) {
      widget.agentAvatarUrl = this.nullableString(dto.agentAvatarUrl);
    }
    if (dto.brandFooterEnabled !== undefined) {
      widget.brandFooterEnabled = dto.brandFooterEnabled;
    }
    if (dto.brandFooterText !== undefined) {
      widget.brandFooterText = dto.brandFooterText.trim() || 'By Lyra Suite';
    }
    if (dto.leadCaptureEnabled !== undefined) {
      widget.leadCaptureEnabled = dto.leadCaptureEnabled;
    }
    if (dto.leadCaptureMode !== undefined) {
      widget.leadCaptureMode = dto.leadCaptureMode;
    }
    if (dto.metadata !== undefined)
      widget.metadata = this.stampContext(ctx, dto.metadata);

    return this.widgetsRepository.save(widget);
  }

  async activateWidget(ctx: RequestContext, widgetId: string) {
    const widget = await this.findWidgetOrFail(ctx, widgetId);
    widget.status = 'active';
    return this.widgetsRepository.save(widget);
  }

  async deactivateWidget(ctx: RequestContext, widgetId: string) {
    const widget = await this.findWidgetOrFail(ctx, widgetId);
    widget.status = 'inactive';
    return this.widgetsRepository.save(widget);
  }

  async deleteWidget(ctx: RequestContext, widgetId: string) {
    const widget = await this.findWidgetOrFail(ctx, widgetId);

    await this.widgetsRepository.softDelete({
      id: widget.id,
      tenantId: widget.tenantId,
      workspaceId: widget.workspaceId,
    });

    return { deleted: true };
  }

  async uploadWidgetAvatar(
    ctx: RequestContext,
    widgetId: string,
    file: Express.Multer.File,
  ) {
    const widget = await this.findWidgetOrFail(ctx, widgetId);

    const stored = await this.filesService.uploadImageAsset({
      file,
      path: `tenants/${widget.tenantId}/webchat/widgets/${widget.id}/avatar-${Date.now()}.webp`,
      maxDimension: 512,
    });

    widget.agentAvatarUrl = stored.url;
    await this.widgetsRepository.save(widget);

    return {
      avatarUrl: stored.url,
      avatarPath: stored.path,
    };
  }

  async listWidgetConversations(
    ctx: RequestContext,
    widgetId: string,
    query: ListWidgetConversationsQuery,
  ) {
    const widget = await this.findWidgetOrFail(ctx, widgetId);
    const limit = this.normalizeLimit(query.limit);
    const offset = this.normalizeOffset(query.offset);

    const where: {
      tenantId: string;
      workspaceId: string;
      widgetId: string;
      status?: WebchatConversationEntity['status'];
    } = {
      tenantId: widget.tenantId,
      workspaceId: widget.workspaceId,
      widgetId: widget.id,
    };

    if (query.status) {
      if (!this.isValidConversationStatus(query.status)) {
        throw new BadRequestException('Invalid conversation status.');
      }

      (
        where as unknown as { status: WebchatConversationEntity['status'] }
      ).status = query.status as WebchatConversationEntity['status'];
    }

    const [items, total] = await this.conversationsRepository.findAndCount({
      where,
      order: {
        lastMessageAt: 'DESC',
        createdAt: 'DESC',
      },
      take: limit,
      skip: offset,
    });

    return {
      items,
      total,
      limit,
      offset,
    };
  }

  async getConversation(ctx: RequestContext, conversationId: string) {
    return this.findConversationOrFail(ctx, conversationId);
  }

  async listConversationMessages(ctx: RequestContext, conversationId: string) {
    const conversation = await this.findConversationOrFail(ctx, conversationId);

    return this.messagesRepository.find({
      where: {
        tenantId: conversation.tenantId,
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
      },
      order: {
        createdAt: 'ASC',
      },
    });
  }

  async createAdminMessage(
    ctx: RequestContext,
    conversationId: string,
    dto: CreateWebchatAdminMessageDto,
  ) {
    const userId = this.requireUserId(ctx);
    const conversation = await this.findConversationOrFail(ctx, conversationId);

    const message = this.messagesRepository.create({
      tenantId: conversation.tenantId,
      workspaceId: conversation.workspaceId,
      widgetId: conversation.widgetId,
      conversationId: conversation.id,
      visitorId: conversation.visitorId,
      senderType: 'agent',
      senderUserId: userId,
      senderAgentId: null,
      direction: 'outbound',
      messageType: 'text',
      content: dto.content.trim(),
      metadata: dto.metadata ?? {},
    });

    if (!message.content) {
      throw new BadRequestException('Message content is required.');
    }

    conversation.status =
      conversation.status === 'new' ? 'active' : conversation.status;
    conversation.lastMessageAt = new Date();

    await this.conversationsRepository.save(conversation);
    const savedMessage = await this.messagesRepository.save(message);

    await this.inboxService.createMessageFromWebchat({
      tenantId: savedMessage.tenantId,
      workspaceId: savedMessage.workspaceId,
      widgetId: savedMessage.widgetId,
      visitorId: savedMessage.visitorId,
      conversationId: savedMessage.conversationId,
      messageId: savedMessage.id,
      senderType: savedMessage.senderType,
      senderUserId: savedMessage.senderUserId,
      senderAgentId: savedMessage.senderAgentId,
      direction: savedMessage.direction,
      messageType: savedMessage.messageType,
      content: savedMessage.content,
      metadata: savedMessage.metadata,
      createdAt: savedMessage.createdAt,
    });

    return savedMessage;
  }

  async closeConversation(ctx: RequestContext, conversationId: string) {
    const conversation = await this.findConversationOrFail(ctx, conversationId);

    conversation.status = 'closed';
    conversation.closedAt = new Date();

    return this.conversationsRepository.save(conversation);
  }

  async getPublicWidgetConfig(publicKey: string, origin?: string) {
    const widget = await this.findPublicWidgetOrFail(publicKey);

    this.ensureOriginAllowed(widget, origin);

    return this.toPublicWidgetConfig(widget);
  }

  async createPublicVisitor(
    publicKey: string,
    dto: CreatePublicWebchatVisitorDto,
    origin?: string,
    userAgent?: string,
  ) {
    const widget = await this.findPublicWidgetOrFail(publicKey);
    this.ensureOriginAllowed(widget, origin);

    let visitor = await this.visitorsRepository.findOne({
      where: {
        widgetId: widget.id,
        anonymousId: dto.anonymousId,
      },
    });

    const now = new Date();

    if (!visitor) {
      visitor = this.visitorsRepository.create({
        tenantId: widget.tenantId,
        workspaceId: widget.workspaceId,
        widgetId: widget.id,
        contactId: null,
        anonymousId: dto.anonymousId,
        firstSeenAt: now,
      });
    }

    visitor.name = this.nullableString(dto.name);
    visitor.email = this.nullableString(dto.email);
    visitor.phone = this.nullableString(dto.phone);
    visitor.locale = this.nullableString(dto.locale);
    visitor.userAgent = userAgent ?? visitor.userAgent ?? null;
    visitor.lastSeenAt = now;
    visitor.metadata = dto.metadata ?? visitor.metadata ?? {};

    const savedVisitor = await this.visitorsRepository.save(visitor);

    return this.toPublicVisitor(savedVisitor);
  }

  async createPublicConversation(
    publicKey: string,
    dto: CreatePublicWebchatConversationDto,
    origin?: string,
  ) {
    const widget = await this.findPublicWidgetOrFail(publicKey);
    this.ensureOriginAllowed(widget, origin);

    const visitor = await this.findPublicVisitorOrFail(widget, dto.visitorId);

    const conversation = this.conversationsRepository.create({
      tenantId: widget.tenantId,
      workspaceId: widget.workspaceId,
      widgetId: widget.id,
      visitorId: visitor.id,
      contactId: visitor.contactId,
      status: 'new',
      source: 'webchat',
      pageUrl: this.optionalString(dto.pageUrl),
      pageTitle: this.optionalString(dto.pageTitle),
      referrer: this.optionalString(dto.referrer),
      utmSource: this.optionalString(dto.utmSource),
      utmMedium: this.optionalString(dto.utmMedium),
      utmCampaign: this.optionalString(dto.utmCampaign),
      assignedUserId: null,
      assignedAgentId: widget.defaultAgentId,
      aiEnabled: widget.aiEnabled,
      lastMessageAt: null,
      closedAt: null,
      metadata: dto.metadata ?? {},
    });

    const savedConversation =
      await this.conversationsRepository.save(conversation);

    await this.inboxService.upsertConversationFromWebchat({
      tenantId: savedConversation.tenantId,
      workspaceId: savedConversation.workspaceId,
      widgetId: savedConversation.widgetId,
      visitorId: savedConversation.visitorId,
      conversationId: savedConversation.id,
      contactId: savedConversation.contactId,
      status: savedConversation.status,
      source: savedConversation.source,
      pageUrl: savedConversation.pageUrl,
      pageTitle: savedConversation.pageTitle,
      referrer: savedConversation.referrer,
      utmSource: savedConversation.utmSource,
      utmMedium: savedConversation.utmMedium,
      utmCampaign: savedConversation.utmCampaign,
      assignedUserId: savedConversation.assignedUserId,
      assignedAgentId: savedConversation.assignedAgentId,
      aiEnabled: savedConversation.aiEnabled,
      lastMessageAt: savedConversation.lastMessageAt,
      metadata: {
        ...(savedConversation.metadata ?? {}),
        visitorName: visitor.name,
        visitorEmail: visitor.email,
        visitorPhone: visitor.phone,
        visitorIpHash: visitor.ipHash,
      },
    });

    if (widget.initialMessage) {
      const systemMessage = this.messagesRepository.create({
        tenantId: widget.tenantId,
        workspaceId: widget.workspaceId,
        widgetId: widget.id,
        conversationId: savedConversation.id,
        visitorId: visitor.id,
        senderType: widget.aiEnabled ? 'ai' : 'system',
        senderUserId: null,
        senderAgentId: widget.defaultAgentId,
        direction: 'outbound',
        messageType: 'text',
        content: widget.initialMessage,
        metadata: {
          autoGenerated: true,
          source: 'initial_message',
        },
      });

      savedConversation.lastMessageAt = new Date();
      const savedSystemMessage =
        await this.messagesRepository.save(systemMessage);

      await this.inboxService.createMessageFromWebchat({
        tenantId: savedSystemMessage.tenantId,
        workspaceId: savedSystemMessage.workspaceId,
        widgetId: savedSystemMessage.widgetId,
        visitorId: savedSystemMessage.visitorId,
        conversationId: savedSystemMessage.conversationId,
        messageId: savedSystemMessage.id,
        senderType: savedSystemMessage.senderType,
        senderUserId: savedSystemMessage.senderUserId,
        senderAgentId: savedSystemMessage.senderAgentId,
        direction: savedSystemMessage.direction,
        messageType: savedSystemMessage.messageType,
        content: savedSystemMessage.content,
        metadata: savedSystemMessage.metadata,
        createdAt: savedSystemMessage.createdAt,
      });
      await this.conversationsRepository.save(savedConversation);
    }

    return this.toPublicConversation(savedConversation);
  }

  async createPublicMessage(
    conversationId: string,
    dto: CreatePublicWebchatMessageDto,
    origin?: string,
  ) {
    const conversation = await this.conversationsRepository.findOne({
      where: {
        id: conversationId,
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found.');
    }

    const widget = await this.widgetsRepository.findOne({
      where: {
        id: conversation.widgetId,
        status: 'active',
      },
    });

    if (!widget) {
      throw new NotFoundException('Webchat widget not found.');
    }

    this.ensureOriginAllowed(widget, origin);

    if (conversation.visitorId !== dto.visitorId) {
      throw new ForbiddenException(
        'Visitor does not belong to this conversation.',
      );
    }

    if (['closed', 'archived'].includes(conversation.status)) {
      throw new BadRequestException('Conversation is closed.');
    }

    const content = dto.content.trim();

    if (!content) {
      throw new BadRequestException('Message content is required.');
    }

    const message = this.messagesRepository.create({
      tenantId: conversation.tenantId,
      workspaceId: conversation.workspaceId,
      widgetId: conversation.widgetId,
      conversationId: conversation.id,
      visitorId: conversation.visitorId,
      senderType: 'visitor',
      senderUserId: null,
      senderAgentId: null,
      direction: 'inbound',
      messageType: 'text',
      content,
      metadata: dto.metadata ?? {},
    });

    conversation.status =
      conversation.status === 'new' ? 'active' : conversation.status;
    conversation.lastMessageAt = new Date();

    await this.conversationsRepository.save(conversation);
    const savedMessage = await this.messagesRepository.save(message);

    const visitor = await this.visitorsRepository.findOne({
      where: {
        id: conversation.visitorId,
        widgetId: conversation.widgetId,
      },
    });

    const leadEvaluation = await this.inboxSettingsService.evaluateLeadRules(
      {
        tenantId: conversation.tenantId,
        workspaceId: conversation.workspaceId,
      },
      {
        channelType: 'webchat',
        text: savedMessage.content,
        visitor: {
          name: visitor?.name,
          email: visitor?.email,
          phone: visitor?.phone,
        },
      },
    );

    const conversationMetadata: Record<string, unknown> = {
      visitorName: visitor?.name ?? null,
      visitorEmail: visitor?.email ?? null,
      visitorPhone: visitor?.phone ?? null,
      visitorIpHash: visitor?.ipHash ?? null,
      leadEvaluationCheckedAt: new Date().toISOString(),
    };

    let linkedContactId: string | null = null;

    if (leadEvaluation.isLead && visitor) {
      const linkedContact =
        await this.contactsService.findOrCreateLeadFromWebchat(
          {
            tenantId: conversation.tenantId,
            workspaceId: conversation.workspaceId,
          },
          {
            name: visitor.name,
            email: visitor.email,
            phone: visitor.phone,
            webchatVisitorId: visitor.id,
            webchatConversationId: conversation.id,
            pageUrl: conversation.pageUrl,
            pageTitle: conversation.pageTitle,
          },
        );

      linkedContactId = linkedContact?.id ?? null;

      if (linkedContactId) {
        Object.assign(conversationMetadata, {
          contactId: linkedContactId,
          contactLinkedFromWebchat: true,
          contactLinkedAt: new Date().toISOString(),
        });
      }
    }

    if (leadEvaluation.isLead) {
      Object.assign(conversationMetadata, {
        isLead: true,
        leadMarkedAutomatically: true,
        leadMarkedAt: new Date().toISOString(),
        leadRuleId: leadEvaluation.matchedRuleId,
        leadRuleName: leadEvaluation.matchedRuleName,
        leadReason: leadEvaluation.reason,
      });
    }

    await this.inboxService.createMessageFromWebchat({
      tenantId: savedMessage.tenantId,
      workspaceId: savedMessage.workspaceId,
      widgetId: savedMessage.widgetId,
      visitorId: savedMessage.visitorId,
      conversationId: savedMessage.conversationId,
      messageId: savedMessage.id,
      senderType: savedMessage.senderType,
      senderUserId: savedMessage.senderUserId,
      senderAgentId: savedMessage.senderAgentId,
      direction: savedMessage.direction,
      messageType: savedMessage.messageType,
      content: savedMessage.content,
      metadata: savedMessage.metadata,
      conversationMetadata,
      createdAt: savedMessage.createdAt,
    });

    return this.toPublicMessage(savedMessage);
  }

  async listPublicMessages(
    conversationId: string,
    visitorId: string | undefined,
    origin?: string,
  ) {
    if (!visitorId) {
      throw new BadRequestException('visitorId query parameter is required.');
    }

    const conversation = await this.conversationsRepository.findOne({
      where: {
        id: conversationId,
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found.');
    }

    const widget = await this.widgetsRepository.findOne({
      where: {
        id: conversation.widgetId,
        status: 'active',
      },
    });

    if (!widget) {
      throw new NotFoundException('Webchat widget not found.');
    }

    this.ensureOriginAllowed(widget, origin);

    if (conversation.visitorId !== visitorId) {
      throw new ForbiddenException(
        'Visitor does not belong to this conversation.',
      );
    }

    const messages = await this.messagesRepository.find({
      where: {
        conversationId: conversation.id,
        widgetId: conversation.widgetId,
      },
      order: {
        createdAt: 'ASC',
      },
    });

    return messages.map((message) => this.toPublicMessage(message));
  }

  private async findWidgetOrFail(ctx: RequestContext, widgetId: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const widget = await this.widgetsRepository.findOne({
      where: this.withClientScope(ctx, {
        id: widgetId,
        tenantId: ctx.tenantId,
        workspaceId,
      }),
    });

    if (!widget) {
      throw new NotFoundException('Webchat widget not found.');
    }

    return widget;
  }

  private async findConversationOrFail(
    ctx: RequestContext,
    conversationId: string,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const conversation = await this.conversationsRepository.findOne({
      where: {
        id: conversationId,
        tenantId: ctx.tenantId,
        workspaceId,
      },
    });

    if (!conversation) {
      throw new NotFoundException('Webchat conversation not found.');
    }

    return conversation;
  }

  private async findPublicWidgetOrFail(publicKey: string) {
    const widget = await this.widgetsRepository.findOne({
      where: {
        publicKey,
        status: 'active',
      },
    });

    if (!widget) {
      throw new NotFoundException('Webchat widget not found.');
    }

    return widget;
  }

  private async findPublicVisitorOrFail(
    widget: WebchatWidgetEntity,
    visitorId: string,
  ) {
    const visitor = await this.visitorsRepository.findOne({
      where: {
        id: visitorId,
        tenantId: widget.tenantId,
        workspaceId: widget.workspaceId,
        widgetId: widget.id,
      },
    });

    if (!visitor) {
      throw new NotFoundException('Webchat visitor not found.');
    }

    return visitor;
  }

  private toPublicWidgetConfig(widget: WebchatWidgetEntity) {
    return {
      publicKey: widget.publicKey,
      title: widget.title,
      subtitle: widget.subtitle,
      initialMessage: widget.initialMessage,
      primaryColor: widget.primaryColor,
      position: widget.position,
      defaultLocale: widget.defaultLocale,
      aiEnabled: widget.aiEnabled,
      agentDisplayName: widget.agentDisplayName,
      agentAvatarUrl: widget.agentAvatarUrl,
      brandFooterEnabled: widget.brandFooterEnabled,
      brandFooterText: widget.brandFooterText,
      leadCaptureEnabled: widget.leadCaptureEnabled,
      leadCaptureMode: widget.leadCaptureMode,
      metadata: widget.metadata,
    };
  }

  private toPublicVisitor(visitor: WebchatVisitorEntity) {
    return {
      id: visitor.id,
      anonymousId: visitor.anonymousId,
      name: visitor.name,
      email: visitor.email,
      phone: visitor.phone,
      locale: visitor.locale,
      firstSeenAt: visitor.firstSeenAt,
      lastSeenAt: visitor.lastSeenAt,
      createdAt: visitor.createdAt,
      updatedAt: visitor.updatedAt,
    };
  }

  private toPublicConversation(conversation: WebchatConversationEntity) {
    return {
      id: conversation.id,
      visitorId: conversation.visitorId,
      status: conversation.status,
      source: conversation.source,
      pageUrl: conversation.pageUrl,
      pageTitle: conversation.pageTitle,
      aiEnabled: conversation.aiEnabled,
      lastMessageAt: conversation.lastMessageAt,
      closedAt: conversation.closedAt,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  private toPublicMessage(message: WebchatMessageEntity) {
    return {
      id: message.id,
      conversationId: message.conversationId,
      visitorId: message.visitorId,
      senderType: message.senderType,
      direction: message.direction,
      messageType: message.messageType,
      content: message.content,
      metadata: message.metadata,
      createdAt: message.createdAt,
    };
  }

  private ensureOriginAllowed(widget: WebchatWidgetEntity, origin?: string) {
    const allowedDomains = widget.allowedDomains ?? [];

    if (allowedDomains.length === 0) {
      return;
    }

    const originHost = this.extractHost(origin);

    if (!originHost) {
      throw new ForbiddenException('Origin is required for this widget.');
    }

    const isAllowed = allowedDomains.some((domain) => {
      const allowedHost = this.extractHost(domain) ?? domain.toLowerCase();

      return (
        originHost === allowedHost || originHost.endsWith(`.${allowedHost}`)
      );
    });

    if (!isAllowed) {
      throw new ForbiddenException('Origin is not allowed for this widget.');
    }
  }

  private extractHost(value?: string | null) {
    if (!value) {
      return null;
    }

    const normalized = value.trim().toLowerCase();

    if (!normalized) {
      return null;
    }

    try {
      return new URL(normalized).hostname;
    } catch {
      return normalized
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split('/')[0]
        .split(':')[0]
        .trim();
    }
  }

  private normalizeDomains(domains?: string[]) {
    if (!domains) {
      return [];
    }

    return Array.from(
      new Set(
        domains
          .map((domain) => this.extractHost(domain))
          .filter((domain): domain is string => Boolean(domain)),
      ),
    );
  }

  /**
   * Restricts a widget query to the LeadFlow operating context of the request.
   * In client mode only widgets stamped with the selected client's id match; in
   * agency mode we match agency-owned or legacy (pre-scoping) widgets. Mirrors
   * the CRM/Inbox scoping so each managed client only sees its own widgets.
   */
  private withClientScope<T>(
    ctx: RequestContext,
    where: FindOptionsWhere<T>,
  ): FindOptionsWhere<T> {
    const managed = ctx.managedContext;
    const scoped = { ...where } as Record<string, unknown>;

    if (managed?.operatingMode === 'client') {
      scoped.metadata = Raw(
        (column) => `${column} ->> 'clientId' = :lfClientId`,
        { lfClientId: managed.clientId },
      );
    } else {
      scoped.metadata = Raw(
        (column) =>
          `(${column} ->> 'clientId' IS NULL OR ${column} ->> 'operatingMode' = 'agency')`,
      );
    }

    return scoped as FindOptionsWhere<T>;
  }

  /**
   * Stamps the current LeadFlow operating context into a widget's metadata so it
   * can later be filtered by {@link withClientScope}. Existing metadata keys
   * (lead capture copy, theme, etc.) are preserved.
   */
  private stampContext(
    ctx: RequestContext,
    metadata: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const managed = ctx.managedContext;

    if (!managed) return { ...metadata };

    const next: Record<string, unknown> = {
      ...metadata,
      productKey: managed.productKey,
      operatingMode: managed.operatingMode,
      clientId: managed.clientId,
      managedTenantId: managed.managedTenantId,
    };

    if (managed.clientName !== undefined && managed.clientName !== null) {
      next.clientName = managed.clientName;
    }

    return next;
  }

  private requireWorkspaceId(ctx: RequestContext) {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }

    return ctx.workspaceId;
  }

  private requireUserId(ctx: RequestContext) {
    if (!ctx.userId) {
      throw new BadRequestException('User context is required.');
    }

    return ctx.userId;
  }

  private isValidConversationStatus(status: string) {
    return [
      'new',
      'active',
      'waiting',
      'handoff_requested',
      'resolved',
      'closed',
      'archived',
    ].includes(status);
  }

  private normalizeLimit(value?: string) {
    const parsed = Number(value ?? 50);

    if (!Number.isFinite(parsed)) {
      return 50;
    }

    return Math.min(Math.max(parsed, 1), 100);
  }

  private normalizeOffset(value?: string) {
    const parsed = Number(value ?? 0);

    if (!Number.isFinite(parsed)) {
      return 0;
    }

    return Math.max(parsed, 0);
  }

  private optionalString(value?: string) {
    if (value === undefined) {
      return null;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : null;
  }

  private nullableString(value?: string | null) {
    if (value === undefined || value === null) {
      return null;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : null;
  }

  private slugify(value: string) {
    const slug = value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return slug || 'webchat';
  }
}
