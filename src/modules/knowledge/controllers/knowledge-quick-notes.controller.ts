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
import { CreateKnowledgeQuickNoteDto } from '../dto';
import { KnowledgeQuickNotesService } from '../services';
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

@Controller('agency/knowledge/notes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class KnowledgeQuickNotesController {
  constructor(private readonly notesService: KnowledgeQuickNotesService) {}

  @Get()
  @RequirePermission('agency.knowledge.wall.post')
  list(@AuthorizedContext() context: AuthorizedRequestContext) {
    return this.notesService.list(context);
  }

  @Post()
  @RequirePermission('agency.knowledge.wall.post')
  create(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() body: CreateKnowledgeQuickNoteDto,
  ) {
    return this.notesService.create(context, body);
  }

  // ── Personal board (any authenticated user, scoped to themselves) ────────

  @Get('personal')
  listPersonal(
    @AuthorizedContext() context: AuthorizedRequestContext,
  ) {
    return this.notesService.listPersonal(context);
  }

  @Post('personal')
  createPersonal(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() body: CreateKnowledgeQuickNoteDto,
  ) {
    return this.notesService.createPersonal(context, body);
  }

  @Patch('personal/:id')
  updatePersonal(
    @AuthorizedContext() context: AuthorizedRequestContext,
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
      context,
      id,
      body,
    );
  }

  @Delete('personal/:id')
  @DangerousAction()
  deletePersonal(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.notesService.deletePersonal(context, id);
  }

  @Patch(':id')
  @RequirePermission('agency.knowledge.categories.manage.admin')
  update(
    @AuthorizedContext() context: AuthorizedRequestContext,
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
    return this.notesService.update(context, id, body);
  }

  @Delete(':id')
  @RequirePermission('agency.knowledge.categories.manage.admin')
  @DangerousAction()
  delete(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.notesService.delete(context, id);
  }
}
