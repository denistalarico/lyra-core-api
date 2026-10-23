import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import {
  CreateInboxFollowupTemplateDto,
  UpdateInboxFollowupTemplateDto,
} from '../dto/inbox-followup.dto';
import { InboxFollowupTemplateEntity } from '../entities/inbox-followup-template.entity';
import { resolveInboxCompanyScope } from '../inbox-company-scope';

/**
 * CRUD of the Lyra follow-up templates, always inside the request's own
 * company scope (the same scope `inbox_settings` uses). A template of another
 * company is indistinguishable from one that does not exist.
 */
@Injectable()
export class InboxFollowupTemplatesService {
  constructor(
    @InjectRepository(InboxFollowupTemplateEntity, 'agency')
    private readonly templates: Repository<InboxFollowupTemplateEntity>,
  ) {}

  list(ctx: RequestContext): Promise<InboxFollowupTemplateEntity[]> {
    return this.templates.find({
      where: this.scopeWhere(ctx),
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async create(
    ctx: RequestContext,
    dto: CreateInboxFollowupTemplateDto,
  ): Promise<InboxFollowupTemplateEntity> {
    const scope = resolveInboxCompanyScope(ctx);
    return this.templates.save(
      this.templates.create({
        ...scope,
        name: dto.name.trim(),
        stepKey: dto.stepKey,
        channelTypes: uniqueChannels(dto.channelTypes),
        body: dto.body.trim(),
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      }),
    );
  }

  async update(
    ctx: RequestContext,
    id: string,
    dto: UpdateInboxFollowupTemplateDto,
  ): Promise<InboxFollowupTemplateEntity> {
    const template = await this.findInScope(ctx, id);
    // Field by field: a PATCH that omits a field must leave it alone, never
    // write `undefined` over it.
    if (dto.name !== undefined) template.name = dto.name.trim();
    if (dto.stepKey !== undefined) template.stepKey = dto.stepKey;
    if (dto.channelTypes !== undefined) {
      template.channelTypes = uniqueChannels(dto.channelTypes);
    }
    if (dto.body !== undefined) template.body = dto.body.trim();
    if (dto.isActive !== undefined) template.isActive = dto.isActive;
    if (dto.sortOrder !== undefined) template.sortOrder = dto.sortOrder;
    return this.templates.save(template);
  }

  async remove(ctx: RequestContext, id: string): Promise<{ id: string }> {
    const template = await this.findInScope(ctx, id);
    await this.templates.delete({ id: template.id });
    return { id };
  }

  /** An active template the request may use on this channel. */
  async findUsable(
    ctx: RequestContext,
    id: string,
    channelType: string,
  ): Promise<InboxFollowupTemplateEntity> {
    const template = await this.findInScope(ctx, id);
    if (
      !template.isActive ||
      (template.channelTypes.length > 0 &&
        !template.channelTypes.includes(channelType))
    ) {
      throw new NotFoundException('Follow-up template not available.');
    }
    return template;
  }

  private async findInScope(
    ctx: RequestContext,
    id: string,
  ): Promise<InboxFollowupTemplateEntity> {
    const template = await this.templates.findOne({
      where: { id, ...this.scopeWhere(ctx) },
    });
    if (!template) {
      throw new NotFoundException('Follow-up template not found.');
    }
    return template;
  }

  private scopeWhere(ctx: RequestContext) {
    const scope = resolveInboxCompanyScope(ctx);
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId ?? IsNull(),
      companyContextId: scope.companyContextId ?? IsNull(),
      scopeKind: scope.scopeKind,
    };
  }
}

function uniqueChannels(value: string[] | undefined): string[] {
  return [...new Set(value ?? [])];
}
