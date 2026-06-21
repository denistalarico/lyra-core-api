import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  DangerousAction,
  PermissionsGuard,
  RequirePermission,
} from '../../permissions';
import { CreateKnowledgeCategoryDto, UpdateKnowledgeCategoryDto } from '../dto';
import { KnowledgeCategoriesService } from '../services';
import { KnowledgeContext } from '../services/knowledge-context';

function buildKnowledgeContext(
  headers: Record<string, string | string[] | undefined>,
): KnowledgeContext {
  return {
    tenantId: String(headers['x-tenant-id'] ?? ''),
    workspaceId: String(headers['x-workspace-id'] ?? ''),
    userId: String(headers['x-user-id'] ?? ''),
    role: String(headers['x-user-role'] ?? ''),
  };
}

@Controller('agency/knowledge/categories')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class KnowledgeCategoriesController {
  constructor(private readonly categoriesService: KnowledgeCategoriesService) {}

  @Get()
  @RequirePermission('agency.knowledge.articles.view.published')
  list(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.categoriesService.list(buildKnowledgeContext(headers));
  }

  @Post()
  @RequirePermission('agency.knowledge.categories.manage.admin')
  create(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateKnowledgeCategoryDto,
  ) {
    return this.categoriesService.create(buildKnowledgeContext(headers), dto);
  }

  @Patch(':id')
  @RequirePermission('agency.knowledge.categories.manage.admin')
  update(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeCategoryDto,
  ) {
    return this.categoriesService.update(
      buildKnowledgeContext(headers),
      id,
      dto,
    );
  }

  @Delete(':id')
  @RequirePermission('agency.knowledge.categories.manage.admin')
  @DangerousAction()
  delete(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.categoriesService.delete(buildKnowledgeContext(headers), id);
  }
}
