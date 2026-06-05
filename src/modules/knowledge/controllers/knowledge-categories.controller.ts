import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  CreateKnowledgeCategoryDto,
  UpdateKnowledgeCategoryDto,
} from "../dto";
import { KnowledgeCategoriesService } from "../services";
import { KnowledgeContext } from "../services/knowledge-context";

function buildKnowledgeContext(headers: Record<string, string | string[] | undefined>): KnowledgeContext {
  return {
    tenantId: String(headers["x-tenant-id"] ?? ""),
    workspaceId: String(headers["x-workspace-id"] ?? ""),
    userId: String(headers["x-user-id"] ?? ""),
    role: String(headers["x-user-role"] ?? ""),
  };
}

@Controller("agency/knowledge/categories")
export class KnowledgeCategoriesController {
  constructor(
    private readonly categoriesService: KnowledgeCategoriesService,
  ) {}

  @Get()
  list(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.categoriesService.list(buildKnowledgeContext(headers));
  }

  @Post()
  create(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateKnowledgeCategoryDto,
  ) {
    return this.categoriesService.create(buildKnowledgeContext(headers), dto);
  }

  @Patch(":id")
  update(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("id") id: string,
    @Body() dto: UpdateKnowledgeCategoryDto,
  ) {
    return this.categoriesService.update(buildKnowledgeContext(headers), id, dto);
  }
}
