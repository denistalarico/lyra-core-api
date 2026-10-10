import { ForbiddenException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AgencyKnowledgeQuickNote } from "../entities";
import { AgencyKnowledgeScope } from "../enums";
import type { CreateKnowledgeQuickNoteDto } from "../dto";
import { KnowledgeAuthorshipService } from "./knowledge-authorship.service";
import type { KnowledgeContext } from "./knowledge-context";

/** `author_name` is NOT NULL and predates the snapshot; it mirrors the value. */
const LEGACY_AUTHOR_NAME_LENGTH = 120;

type UpdateNoteDto = {
  title?: string;
  body?: string | null;
  color?: string | null;
  tags?: string[];
  positionX?: number;
  positionY?: number;
};

@Injectable()
export class KnowledgeQuickNotesService {
  constructor(
    @InjectRepository(AgencyKnowledgeQuickNote, "agency")
    private readonly notesRepo: Repository<AgencyKnowledgeQuickNote>,
    private readonly authorshipService: KnowledgeAuthorshipService,
  ) {}

  list(context: KnowledgeContext) {
    return this.notesRepo.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        scope: AgencyKnowledgeScope.SHARED,
      },
      order: { createdAt: "DESC" },
    });
  }

  // Personal board: notes owned by and visible only to their author.
  listPersonal(context: KnowledgeContext) {
    return this.notesRepo.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        scope: AgencyKnowledgeScope.PERSONAL,
        authorId: context.userId,
      },
      order: { createdAt: "DESC" },
    });
  }

  create(context: KnowledgeContext, dto: CreateKnowledgeQuickNoteDto) {
    return this.createScoped(context, dto, AgencyKnowledgeScope.SHARED);
  }

  createPersonal(context: KnowledgeContext, dto: CreateKnowledgeQuickNoteDto) {
    return this.createScoped(context, dto, AgencyKnowledgeScope.PERSONAL);
  }

  private async createScoped(
    context: KnowledgeContext,
    dto: CreateKnowledgeQuickNoteDto,
    scope: AgencyKnowledgeScope,
  ) {
    // SEC-A1: authorship comes from the authenticated user, never the body.
    const authorship = await this.authorshipService.resolve(
      context,
      dto.authorDisplayMode,
    );
    const note = this.notesRepo.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      authorId: context.userId,
      authorName: authorship.authorDisplayValue.slice(
        0,
        LEGACY_AUTHOR_NAME_LENGTH,
      ),
      ...authorship,
      title: dto.title,
      body: dto.body ?? null,
      color: dto.color ?? null,
      tags: dto.tags ?? [],
      positionX: dto.positionX ?? 0,
      positionY: dto.positionY ?? 0,
      scope,
    });
    return this.notesRepo.save(note);
  }

  async update(context: KnowledgeContext, id: string, dto: UpdateNoteDto) {
    const patch = this.buildPatch(dto);
    await this.notesRepo.update(
      { id, tenantId: context.tenantId, workspaceId: context.workspaceId },
      patch,
    );
    return this.notesRepo.findOneOrFail({ where: { id } });
  }

  async updatePersonal(context: KnowledgeContext, id: string, dto: UpdateNoteDto) {
    await this.getPersonalOrFail(context, id);
    const patch = this.buildPatch(dto);
    await this.notesRepo.update(
      { id, tenantId: context.tenantId, workspaceId: context.workspaceId },
      patch,
    );
    return this.notesRepo.findOneOrFail({ where: { id } });
  }

  async delete(context: KnowledgeContext, id: string) {
    await this.notesRepo.delete({
      id,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
    });
    return { deleted: true, id };
  }

  async deletePersonal(context: KnowledgeContext, id: string) {
    await this.getPersonalOrFail(context, id);
    await this.notesRepo.delete({
      id,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
    });
    return { deleted: true, id };
  }

  private buildPatch(dto: UpdateNoteDto): Partial<AgencyKnowledgeQuickNote> {
    const patch: Partial<AgencyKnowledgeQuickNote> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.body !== undefined) patch.body = dto.body ?? null;
    if (dto.color !== undefined) patch.color = dto.color ?? null;
    if (dto.tags !== undefined) patch.tags = dto.tags;
    if (dto.positionX !== undefined) patch.positionX = dto.positionX;
    if (dto.positionY !== undefined) patch.positionY = dto.positionY;
    return patch;
  }

  private async getPersonalOrFail(context: KnowledgeContext, id: string) {
    const note = await this.notesRepo.findOne({
      where: { id, tenantId: context.tenantId, workspaceId: context.workspaceId },
    });
    if (
      !note ||
      note.scope !== AgencyKnowledgeScope.PERSONAL ||
      note.authorId !== context.userId
    ) {
      throw new ForbiddenException("You do not have access to this personal note");
    }
    return note;
  }
}
