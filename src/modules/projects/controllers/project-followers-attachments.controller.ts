import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
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
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/projects/:projectId')
export class ProjectFollowersAttachmentsController {
  constructor(private readonly svc: ProjectFollowersAttachmentsService) {}

  // ── Followers ──────────────────────────────────────────────────────────────

  @Get('followers')
  @RequirePermission('agency.projects.project.view.assigned')
  listFollowers(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('projectId') projectId: string,
  ) {
    return this.svc.listFollowers(context, projectId);
  }

  @Post('followers')
  @RequirePermission('agency.projects.project.update.department')
  addFollower(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('projectId') projectId: string,
    @Body() body: { userId: string; userName: string },
  ) {
    return this.svc.addFollower(
      context,
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
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('projectId') projectId: string,
    @Param('followerId') followerId: string,
  ) {
    return this.svc.removeFollower(context, projectId, followerId);
  }

  // ── Attachments ────────────────────────────────────────────────────────────

  @Get('attachments')
  @RequirePermission('agency.projects.project.view.assigned')
  listAttachments(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('projectId') projectId: string,
  ) {
    return this.svc.listAttachments(context, projectId);
  }

  @Post('attachments')
  @RequirePermission('agency.projects.project.update.department')
  @UseInterceptors(FileInterceptor('file', ATTACHMENT_UPLOAD_OPTIONS))
  uploadAttachment(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('projectId') projectId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    return this.svc.uploadAttachment(context, projectId, file);
  }

  @Delete('attachments/:attachmentId')
  @RequireAnyPermission(
    'agency.projects.project.archive.department',
    'agency.projects.project.archive.own',
  )
  @DangerousAction()
  deleteAttachment(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('projectId') projectId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.svc.deleteAttachment(context, projectId, attachmentId);
  }
}
