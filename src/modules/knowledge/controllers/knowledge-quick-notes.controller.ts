import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { KnowledgeQuickNotesService } from "../services";
import type { KnowledgeContext } from "../services/knowledge-context";

function buildKnowledgeContext(headers: Record<string, string | string[] | undefined>): KnowledgeContext {
  return {
    tenantId: String(headers["x-tenant-id"] ?? ""),
    workspaceId: String(headers["x-workspace-id"] ?? ""),
    userId: String(headers["x-user-id"] ?? ""),
    role: String(headers["x-user-role"] ?? ""),
  };
}

@Controller("agency/knowledge/notes")
export class KnowledgeQuickNotesController {
  constructor(private readonly notesService: KnowledgeQuickNotesService) {}

  @Get()
  list(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.notesService.list(buildKnowledgeContext(headers));
  }

  @Post()
  create(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body()
    body: {
      title: string;
      body?: string | null;
      color?: string | null;
      tags?: string[];
      authorName: string;
      positionX?: number;
      positionY?: number;
    },
  ) {
    return this.notesService.create(buildKnowledgeContext(headers), body);
  }

  @Patch(":id")
  update(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("id") id: string,
    @Body()
    body: {
      title?: string;
      body?: string | null;
      color?: string | null;
      tags?: string[];
      positionX?: number;
      positionY?: number;
    },
  ) {
    return this.notesService.update(buildKnowledgeContext(headers), id, body);
  }

  @Delete(":id")
  delete(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("id") id: string,
  ) {
    return this.notesService.delete(buildKnowledgeContext(headers), id);
  }
}
