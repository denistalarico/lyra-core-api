import {
  Body,
  Controller,
  Delete,
  Get,
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
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

@Controller('agency/knowledge/categories')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class KnowledgeCategoriesController {
  constructor(private readonly categoriesService: KnowledgeCategoriesService) {}

  @Get()
  @RequirePermission('agency.knowledge.articles.view.published')
  list(@AuthorizedContext() context: AuthorizedRequestContext) {
    return this.categoriesService.list(context);
  }

  @Post()
  @RequirePermission('agency.knowledge.categories.manage.admin')
  create(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateKnowledgeCategoryDto,
  ) {
    return this.categoriesService.create(context, dto);
  }

  @Patch(':id')
  @RequirePermission('agency.knowledge.categories.manage.admin')
  update(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeCategoryDto,
  ) {
    return this.categoriesService.update(context, id, dto);
  }

  @Delete(':id')
  @RequirePermission('agency.knowledge.categories.manage.admin')
  @DangerousAction()
  delete(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.categoriesService.delete(context, id);
  }
}
