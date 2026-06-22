import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  DangerousAction,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
} from '../../permissions';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

const ATTACHMENT_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
};
import { ProjectFollowersAttachmentsService } from '../services/project-followers-attachments.service';

type RequestContext = { tenantId: string; workspaceId: string; userId: string };

function ctx(
  headers: Record<string, string | string[] | undefined>,
): RequestContext {
  return {
    tenantId: String(headers['x-tenant-id'] ?? ''),
    workspaceId: String(headers['x-workspace-id'] ?? ''),
    userId: String(headers['x-user-id'] ?? ''),
  };
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/projects/:projectId')
export class ProjectFollowersAttachmentsController {
  constructor(private readonly svc: ProjectFollowersAttachmentsService) {}

  // ── Followers ──────────────────────────────────────────────────────────────

  @Get('followers')
  @RequirePermission('agency.projects.project.view.assigned')
  listFollowers(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('projectId') projectId: string,
  ) {
    return this.svc.listFollowers(ctx(headers), projectId);
  }

  @Post('followers')
  @RequirePermission('agency.projects.project.update.department')
  addFollower(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('projectId') projectId: string,
    @Body() body: { userId: string; userName: string },
  ) {
    return this.svc.addFollower(
      ctx(headers),
      projectId,
      body.userId,
      body.userName ?? '',
    );
  }

  @Delete('followers/:followerId')
  @RequireAnyPermission(
    'agency.projects.project.archive.department',
    'agency.projects.project.archive.own',
  )
  @DangerousAction()
  removeFollower(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('projectId') projectId: string,
    @Param('followerId') followerId: string,
  ) {
    return this.svc.removeFollower(ctx(headers), projectId, followerId);
  }

  // ── Attachments ────────────────────────────────────────────────────────────

  @Get('attachments')
  @RequirePermission('agency.projects.project.view.assigned')
  listAttachments(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('projectId') projectId: string,
  ) {
    return this.svc.listAttachments(ctx(headers), projectId);
  }

  @Post('attachments')
  @RequirePermission('agency.projects.project.update.department')
  @UseInterceptors(FileInterceptor('file', ATTACHMENT_UPLOAD_OPTIONS))
  uploadAttachment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('projectId') projectId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    return this.svc.uploadAttachment(ctx(headers), projectId, file);
  }

  @Delete('attachments/:attachmentId')
  @RequireAnyPermission(
    'agency.projects.project.archive.department',
    'agency.projects.project.archive.own',
  )
  @DangerousAction()
  deleteAttachment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('projectId') projectId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.svc.deleteAttachment(ctx(headers), projectId, attachmentId);
  }
}
