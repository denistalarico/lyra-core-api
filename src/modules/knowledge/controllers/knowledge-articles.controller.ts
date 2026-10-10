import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  DangerousAction,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
} from '../../permissions';
import {
  CreateKnowledgeArticleDto,
  ListKnowledgeArticlesQueryDto,
  UpdateKnowledgeArticleDto,
} from '../dto';
import { KnowledgeArticlesService } from '../services';
import { MAX_IMAGE_UPLOAD_BYTES } from '../../../common/files/files.service';
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

const COVER_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES },
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    cb: (err: Error | null, accept: boolean) => void,
  ) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
};

@Controller('agency/knowledge/articles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class KnowledgeArticlesController {
  constructor(private readonly articlesService: KnowledgeArticlesService) {}

  @Get()
  @RequireAnyPermission(
    'agency.knowledge.articles.view.published',
    'agency.knowledge.articles.create.department',
    'agency.knowledge.categories.manage.admin',
  )
  list(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Query() query: ListKnowledgeArticlesQueryDto,
  ) {
    return this.articlesService.list(context, query);
  }

  @Get(':id')
  @RequireAnyPermission(
    'agency.knowledge.articles.view.published',
    'agency.knowledge.articles.create.department',
    'agency.knowledge.categories.manage.admin',
  )
  get(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.articlesService.get(context, id);
  }

  @Post()
  @RequireAnyPermission(
    'agency.knowledge.articles.create.department',
    'agency.knowledge.articles.publish.department',
    'agency.knowledge.categories.manage.admin',
  )
  create(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateKnowledgeArticleDto,
  ) {
    return this.articlesService.create(context, dto);
  }

  @Patch(':id')
  @RequireAnyPermission(
    'agency.knowledge.articles.create.department',
    'agency.knowledge.articles.publish.department',
    'agency.knowledge.categories.manage.admin',
  )
  update(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeArticleDto,
  ) {
    return this.articlesService.update(context, id, dto);
  }

  @Delete(':id')
  @RequirePermission('agency.knowledge.articles.delete.owner_only')
  @DangerousAction()
  remove(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.articlesService.remove(context, id);
  }

  @Post(':id/cover')
  @RequireAnyPermission(
    'agency.knowledge.articles.create.department',
    'agency.knowledge.articles.publish.department',
    'agency.knowledge.categories.manage.admin',
  )
  @UseInterceptors(FileInterceptor('file', COVER_UPLOAD_OPTIONS))
  uploadCover(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Missing multipart field "file".');
    return this.articlesService.uploadCover(context, id, file);
  }
}
