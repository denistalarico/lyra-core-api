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
import { KnowledgeQuickNotesService } from '../services';
import type { KnowledgeContext } from '../services/knowledge-context';

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

@Controller('agency/knowledge/notes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class KnowledgeQuickNotesController {
  constructor(private readonly notesService: KnowledgeQuickNotesService) {}

  @Get()
  @RequirePermission('agency.knowledge.wall.post')
  list(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.notesService.list(buildKnowledgeContext(headers));
  }

  @Post()
  @RequirePermission('agency.knowledge.wall.post')
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

  // ── Personal board (any authenticated user, scoped to themselves) ────────

  @Get('personal')
  listPersonal(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.notesService.listPersonal(buildKnowledgeContext(headers));
  }

  @Post('personal')
  createPersonal(
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
    return this.notesService.createPersonal(buildKnowledgeContext(headers), body);
  }

  @Patch('personal/:id')
  updatePersonal(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
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
    return this.notesService.updatePersonal(
      buildKnowledgeContext(headers),
      id,
      body,
    );
  }

  @Delete('personal/:id')
  @DangerousAction()
  deletePersonal(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.notesService.deletePersonal(buildKnowledgeContext(headers), id);
  }

  @Patch(':id')
  @RequirePermission('agency.knowledge.categories.manage.admin')
  update(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
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

  @Delete(':id')
  @RequirePermission('agency.knowledge.categories.manage.admin')
  @DangerousAction()
  delete(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.notesService.delete(buildKnowledgeContext(headers), id);
  }
}
