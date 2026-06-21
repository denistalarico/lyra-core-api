import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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
import { KnowledgeContext } from '../services/knowledge-context';
import { MAX_IMAGE_UPLOAD_BYTES } from '../../../common/files/files.service';

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

function buildKnowledgeContext(
  headers: Record<string, string | string[] | undefined>,
): KnowledgeContext {
  return {
    tenantId: String(headers['x-tenant-id'] ?? ''),
    workspaceId: String(headers['x-workspace-id'] ?? ''),
    userId: String(headers['x-user-id'] ?? ''),
    role: String(headers['x-user-role'] ?? ''),
    userName: headers['x-user-name']
      ? String(headers['x-user-name'])
      : undefined,
  };
}

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
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: ListKnowledgeArticlesQueryDto,
  ) {
    return this.articlesService.list(buildKnowledgeContext(headers), query);
  }

  @Get(':id')
  @RequireAnyPermission(
    'agency.knowledge.articles.view.published',
    'agency.knowledge.articles.create.department',
    'agency.knowledge.categories.manage.admin',
  )
  get(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.articlesService.get(buildKnowledgeContext(headers), id);
  }

  @Post()
  @RequireAnyPermission(
    'agency.knowledge.articles.create.department',
    'agency.knowledge.articles.publish.department',
    'agency.knowledge.categories.manage.admin',
  )
  create(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateKnowledgeArticleDto,
  ) {
    return this.articlesService.create(buildKnowledgeContext(headers), dto);
  }

  @Patch(':id')
  @RequireAnyPermission(
    'agency.knowledge.articles.create.department',
    'agency.knowledge.articles.publish.department',
    'agency.knowledge.categories.manage.admin',
  )
  update(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeArticleDto,
  ) {
    return this.articlesService.update(buildKnowledgeContext(headers), id, dto);
  }

  @Delete(':id')
  @RequirePermission('agency.knowledge.articles.delete.owner_only')
  @DangerousAction()
  remove(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.articlesService.remove(buildKnowledgeContext(headers), id);
  }

  @Post(':id/cover')
  @RequireAnyPermission(
    'agency.knowledge.articles.create.department',
    'agency.knowledge.articles.publish.department',
    'agency.knowledge.categories.manage.admin',
  )
  @UseInterceptors(FileInterceptor('file', COVER_UPLOAD_OPTIONS))
  uploadCover(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Missing multipart field "file".');
    return this.articlesService.uploadCover(
      buildKnowledgeContext(headers),
      id,
      file,
    );
  }
}
