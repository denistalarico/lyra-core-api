import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  CreateKnowledgeArticleDto,
  ListKnowledgeArticlesQueryDto,
  UpdateKnowledgeArticleDto,
} from "../dto";
import { KnowledgeArticlesService } from "../services";
import { KnowledgeContext } from "../services/knowledge-context";

function buildKnowledgeContext(headers: Record<string, string | string[] | undefined>): KnowledgeContext {
  return {
    tenantId: String(headers["x-tenant-id"] ?? ""),
    workspaceId: String(headers["x-workspace-id"] ?? ""),
    userId: String(headers["x-user-id"] ?? ""),
    role: String(headers["x-user-role"] ?? ""),
  };
}

@Controller("agency/knowledge/articles")
export class KnowledgeArticlesController {
  constructor(
    private readonly articlesService: KnowledgeArticlesService,
  ) {}

  @Get()
  list(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: ListKnowledgeArticlesQueryDto,
  ) {
    return this.articlesService.list(buildKnowledgeContext(headers), query);
  }

  @Get(":id")
  get(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("id") id: string,
  ) {
    return this.articlesService.get(buildKnowledgeContext(headers), id);
  }

  @Post()
  create(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateKnowledgeArticleDto,
  ) {
    return this.articlesService.create(buildKnowledgeContext(headers), dto);
  }

  @Patch(":id")
  update(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("id") id: string,
    @Body() dto: UpdateKnowledgeArticleDto,
  ) {
    return this.articlesService.update(buildKnowledgeContext(headers), id, dto);
  }
}
