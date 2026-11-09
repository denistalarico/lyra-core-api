import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import type { RequestContext } from '../../common/context/request-context.interface';
import { PlatformPermissionService } from '../permissions';
import {
  AgencyProject,
  AgencyTask,
  AgencyTaskAttachment,
  AgencyTaskChecklistItem,
} from '../projects';
import { TasksCrudService } from '../projects/services/tasks-crud.service';
import {
  SocialApprovalPieceEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStepEntity,
} from '../social-approvals/entities';
import { SocialApprovalPieceActionsService } from '../social-approvals/social-approval-piece-actions.service';
import { SocialPlannerApprovalsService } from '../social-planner-approvals/social-planner-approvals.service';
import { SocialPlannerService } from '../social-planner/services/social-planner.service';
import type {
  SendSubtaskApprovalItemDto,
  SubtaskApprovalKind,
} from './dto/social-project-work.dto';
import { SocialContentWorkLinkEntity } from './entities';
import {
  permissionIdentity,
  socialNotContracted,
  SocialWorkGateService,
  type SocialWorkCompany,
} from './social-work-gate.service';
import { SocialWorkStatusService } from './social-work-status.service';

const VIEW_APPROVALS = 'social.approvals.review.view.assigned';
const SEND_STANDALONE = 'social.approvals.review.comment.assigned';
const PLANNER_UPDATE = 'social.planner.calendar.update.manager';
const TASK_UPDATE = 'agency.tasks.task.update.assigned';

const ALL_KINDS: SubtaskApprovalKind[] = ['text', 'link', 'file', 'media'];
const KINDS_BY_STEP: Record<string, SubtaskApprovalKind[]> = {
  copy: ['text'],
  creative: ['media'],
  item: ['text', 'media'],
};

type TaskAccess =
  | { available: false }
  | { available: true; own: true; companies: [] }
  | {
      available: true;
      own: false;
      clientId: string;
      companies: SocialWorkCompany[];
    };

/**
 * R-16 and R-18: the approval section of a subtask.
 *
 * The task says nothing about the company, so the scope is resolved here per
 * task (D-27) and every read is confined to it: this surface has no context
 * header to lean on, unlike the Social routes.
 */
@Injectable()
export class SocialSubtaskApprovalsService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly tasks: TasksCrudService,
    private readonly gate: SocialWorkGateService,
    private readonly permissions: PlatformPermissionService,
    private readonly pieceActions: SocialApprovalPieceActionsService,
    private readonly plannerApprovals: SocialPlannerApprovalsService,
    private readonly planner: SocialPlannerService,
    private readonly status: SocialWorkStatusService,
  ) {}

  private projectContext(ctx: RequestContext) {
    return {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId ?? '',
      userId: ctx.userId ?? '',
      role: ctx.role,
    };
  }

  private async load(ctx: RequestContext, taskId: string, subtaskId: string) {
    const task = await this.tasks.findOne(this.projectContext(ctx), taskId);
    const subtask = await this.dataSource.manager
      .getRepository(AgencyTaskChecklistItem)
      .findOne({
        where: {
          id: subtaskId,
          taskId,
          tenantId: task.tenantId,
          workspaceId: task.workspaceId,
        },
      });
    if (!subtask) throw new NotFoundException('Subtarefa não encontrada.');
    return { task, subtask };
  }

  /** The task's client, else its project's: the same rule as CS5. */
  private async accessOf(
    ctx: RequestContext,
    task: AgencyTask,
  ): Promise<TaskAccess> {
    const project = task.projectId
      ? await this.dataSource.manager.getRepository(AgencyProject).findOne({
          where: {
            id: task.projectId,
            tenantId: task.tenantId,
            workspaceId: task.workspaceId,
          },
          select: { id: true, clientId: true },
        })
      : null;
    const clientId = task.clientId ?? project?.clientId ?? null;
    if (!clientId)
      return (await this.gate.ownAvailable(ctx))
        ? { available: true, own: true, companies: [] }
        : { available: false };
    const companies = await this.gate.companiesOf(ctx, clientId);
    return companies.length > 0
      ? { available: true, own: false, clientId, companies }
      : { available: false };
  }

  private plannerLink(task: AgencyTask, subtaskId: string) {
    return this.dataSource.manager
      .getRepository(SocialContentWorkLinkEntity)
      .findOne({
        where: {
          tenantId: task.tenantId,
          workspaceId: task.workspaceId,
          taskId: task.id,
          subtaskId,
          cancelledAt: IsNull(),
        },
      });
  }

  async section(ctx: RequestContext, taskId: string, subtaskId: string) {
    const { task, subtask } = await this.load(ctx, taskId, subtaskId);
    const access = await this.accessOf(ctx, task);
    const identity = permissionIdentity(ctx);
    if (
      !access.available ||
      !(await this.permissions.can(identity, VIEW_APPROVALS))
    )
      return { available: false as const };

    const link = await this.plannerLink(task, subtask.id);
    const items = link
      ? await this.plannerItems(link)
      : await this.standaloneItems(task, subtask.id);
    const canSend = await this.permissions.can(
      identity,
      link ? PLANNER_UPDATE : SEND_STANDALONE,
    );
    return {
      available: true as const,
      target: link ? ('planner_item' as const) : ('standalone' as const),
      contentItemId: link?.contentItemId ?? null,
      allowedKinds: link ? KINDS_BY_STEP[link.stepKind] : ALL_KINDS,
      canSend,
      company: this.companyView(access, link, items),
      items,
    };
  }

  /** D-27: filled alone with one company, or by the last send with several. */
  private companyView(
    access: Extract<TaskAccess, { available: true }>,
    link: SocialContentWorkLinkEntity | null,
    items: Array<{ companyContextId: string | null }>,
  ) {
    if (link || access.own)
      return {
        required: false,
        selectedId: link?.companyContextId ?? null,
        options: [] as SocialWorkCompany[],
      };
    const previous = items.find((item) =>
      access.companies.some((company) => company.id === item.companyContextId),
    )?.companyContextId;
    const selectedId =
      access.companies.length === 1
        ? access.companies[0].id
        : (previous ?? null);
    return { required: !selectedId, selectedId, options: access.companies };
  }

  private async plannerItems(link: SocialContentWorkLinkEntity) {
    const manager = this.dataSource.manager;
    const piece = await manager
      .getRepository(SocialApprovalPieceEntity)
      .findOne({
        where: {
          tenantId: link.tenantId,
          workspaceId: link.workspaceId,
          kind: 'content_item',
          sourceId: link.contentItemId,
        },
      });
    if (!piece) return [];
    const steps = await manager.getRepository(SocialApprovalStepEntity).find({
      where: {
        pieceId: piece.id,
        kind: In(
          link.stepKind === 'item' ? ['copy', 'creative'] : [link.stepKind],
        ),
      },
      order: { position: 'ASC' },
    });
    return this.itemViews(steps, [piece]);
  }

  private async standaloneItems(task: AgencyTask, subtaskId: string) {
    const manager = this.dataSource.manager;
    const steps = await manager.getRepository(SocialApprovalStepEntity).find({
      where: {
        tenantId: task.tenantId,
        workspaceId: task.workspaceId,
        workTaskId: task.id,
        workSubtaskId: subtaskId,
      },
      order: { createdAt: 'DESC' },
    });
    if (steps.length === 0) return [];
    const pieces = await manager
      .getRepository(SocialApprovalPieceEntity)
      .find({ where: { id: In(steps.map((step) => step.pieceId)) } });
    return this.itemViews(steps, pieces);
  }

  private async itemViews(
    steps: SocialApprovalStepEntity[],
    pieces: SocialApprovalPieceEntity[],
  ) {
    const ids = steps
      .map((step) => step.currentRequestId)
      .filter((id): id is string => Boolean(id));
    const requests = ids.length
      ? await this.dataSource.manager
          .getRepository(SocialApprovalRequestEntity)
          .find({ where: { id: In(ids) } })
      : [];
    return steps.flatMap((step) => {
      const piece = pieces.find((row) => row.id === step.pieceId);
      if (!piece) return [];
      const request = requests.find((row) => row.id === step.currentRequestId);
      return [
        {
          pieceId: piece.id,
          stepId: step.id,
          kind: step.kind,
          title: step.title,
          approvalId: request?.id ?? null,
          status: request?.status ?? null,
          isStale: step.isStale,
          boardColumn: piece.boardColumn,
          finishedAt: piece.finishedAt?.toISOString() ?? null,
          clientId: piece.agencyClientId,
          companyContextId: piece.companyContextId,
        },
      ];
    });
  }

  async send(
    ctx: RequestContext,
    taskId: string,
    subtaskId: string,
    dto: SendSubtaskApprovalItemDto,
  ) {
    const { task, subtask } = await this.load(ctx, taskId, subtaskId);
    const access = await this.accessOf(ctx, task);
    if (!access.available) throw socialNotContracted();
    const link = await this.plannerLink(task, subtask.id);
    const result = link
      ? await this.sendThroughPlanner(ctx, access, link, dto)
      : await this.sendStandalone(ctx, access, task, subtask, dto);
    return { result, section: await this.section(ctx, taskId, subtaskId) };
  }

  /** D-28: the Planner stays the owner of its copy and of the send. */
  private async sendThroughPlanner(
    ctx: RequestContext,
    access: Extract<TaskAccess, { available: true }>,
    link: SocialContentWorkLinkEntity,
    dto: SendSubtaskApprovalItemDto,
  ) {
    if (!KINDS_BY_STEP[link.stepKind].includes(dto.kind))
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'approval_kind_not_allowed',
        message: 'Este tipo não pode ser enviado por esta subtarefa.',
      });
    const allowed = access.own
      ? link.companyContextId === null
      : access.companies.some((row) => row.id === link.companyContextId);
    if (!allowed) throw socialNotContracted();
    await this.permissions.assertCan(permissionIdentity(ctx), PLANNER_UPDATE);

    const userId = ctx.userId!;
    const scope: CompanyAwareScope = {
      tenantId: link.tenantId,
      workspaceId: link.workspaceId,
      agencyClientId: link.agencyClientId,
      companyContextId: link.companyContextId,
    };
    if (dto.kind === 'text') {
      if (!dto.text?.trim()) throw new BadRequestException('Informe o texto.');
      await this.planner.createRevision(scope, link.contentItemId, userId, {
        copy: dto.text,
        source: 'human',
      });
    }
    const sent = await this.plannerApprovals.sendContent(
      {
        ...ctx,
        managedContext: link.agencyClientId
          ? {
              productKey: 'social',
              operatingMode: 'client',
              clientId: link.agencyClientId,
              companyContextId: link.companyContextId,
              managedTenantId: null,
            }
          : undefined,
      },
      link.contentItemId,
      dto.kind === 'text' ? 'copy' : 'creative',
    );
    return {
      target: 'planner_item' as const,
      contentItemId: link.contentItemId,
      copy: sent.copy,
      creative: sent.creative,
    };
  }

  /** R-18: no Planner item behind it, so it is an avulsa with its title. */
  private async sendStandalone(
    ctx: RequestContext,
    access: Extract<TaskAccess, { available: true }>,
    task: AgencyTask,
    subtask: AgencyTaskChecklistItem,
    dto: SendSubtaskApprovalItemDto,
  ) {
    await this.permissions.assertCan(permissionIdentity(ctx), SEND_STANDALONE);
    const scope = this.standaloneScope(ctx, access, task, dto);
    const attachment = dto.attachmentId
      ? await this.dataSource.manager
          .getRepository(AgencyTaskAttachment)
          .findOne({
            where: {
              id: dto.attachmentId,
              taskId: task.id,
              tenantId: task.tenantId,
              workspaceId: task.workspaceId,
            },
          })
      : null;
    if (dto.attachmentId && !attachment)
      throw new NotFoundException('Anexo não encontrado nesta tarefa.');
    const piece = await this.pieceActions.createStandalone(
      scope,
      ctx.userId!,
      {
        title: subtask.title.slice(0, 255),
        stepKind: dto.kind,
        text: dto.text,
        url: dto.url,
        linkLabel: dto.linkLabel,
        mediaAssetId: dto.mediaAssetId,
        fileName: dto.fileName,
        mediaAssetIds: dto.mediaAssetIds,
      },
      {
        origin: 'projects',
        work: {
          projectId: task.projectId,
          taskId: task.id,
          subtaskId: subtask.id,
        },
        attachment: attachment
          ? {
              assetPath: attachment.assetPath,
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
            }
          : undefined,
      },
    );
    return { target: 'standalone' as const, pieceId: piece.id };
  }

  /** D-27: one company fills itself; several need an explicit choice. */
  private standaloneScope(
    ctx: RequestContext,
    access: Extract<TaskAccess, { available: true }>,
    task: AgencyTask,
    dto: SendSubtaskApprovalItemDto,
  ): CompanyAwareScope {
    const base = { tenantId: task.tenantId, workspaceId: task.workspaceId };
    if (access.own)
      return { ...base, agencyClientId: null, companyContextId: null };
    const chosen =
      dto.companyContextId ??
      (access.companies.length === 1 ? access.companies[0].id : null);
    if (!chosen)
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'approval_company_required',
        message: 'Escolha a empresa desta aprovação.',
      });
    if (!access.companies.some((company) => company.id === chosen))
      throw socialNotContracted();
    return {
      ...base,
      agencyClientId: access.clientId,
      companyContextId: chosen,
    };
  }

  /** D-26's safety net for one task, after a failed observer. */
  async reconcileTask(ctx: RequestContext, taskId: string) {
    await this.permissions.assertCan(permissionIdentity(ctx), TASK_UPDATE);
    const task = await this.tasks.findOne(this.projectContext(ctx), taskId);
    if (!(await this.accessOf(ctx, task)).available)
      throw socialNotContracted();
    return {
      changed: await this.status.syncTask(
        task.tenantId,
        task.workspaceId,
        task.id,
      ),
    };
  }
}
