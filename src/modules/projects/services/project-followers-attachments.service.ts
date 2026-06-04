import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgencyProjectAttachment, AgencyProjectFollower } from '../entities';
import { FilesService } from '../../../common/files/files.service';
import { ProjectsCrudService } from './projects-crud.service';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

const MAX_ATTACHMENTS = 10;

@Injectable()
export class ProjectFollowersAttachmentsService {
  constructor(
    @InjectRepository(AgencyProjectFollower, 'agency')
    private readonly followersRepo: Repository<AgencyProjectFollower>,

    @InjectRepository(AgencyProjectAttachment, 'agency')
    private readonly attachmentsRepo: Repository<AgencyProjectAttachment>,

    private readonly filesService: FilesService,
    private readonly projectsCrudService: ProjectsCrudService,
  ) {}

  // ── Followers ──────────────────────────────────────────────────────────────

  async listFollowers(context: RequestContext, projectId: string) {
    await this.projectsCrudService.findOne(context, projectId);
    return this.followersRepo.find({
      where: { tenantId: context.tenantId, workspaceId: context.workspaceId, projectId },
      order: { createdAt: 'ASC' },
    });
  }

  async addFollower(
    context: RequestContext,
    projectId: string,
    userId: string,
    userName: string,
  ) {
    await this.projectsCrudService.findOne(context, projectId);

    const existing = await this.followersRepo.findOne({
      where: { tenantId: context.tenantId, workspaceId: context.workspaceId, projectId, userId },
    });

    if (existing) return existing;

    const follower = this.followersRepo.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      projectId,
      userId,
      userName,
    });

    return this.followersRepo.save(follower);
  }

  async removeFollower(context: RequestContext, projectId: string, followerId: string) {
    await this.projectsCrudService.findOne(context, projectId);

    const follower = await this.followersRepo.findOne({
      where: {
        id: followerId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        projectId,
      },
    });

    if (!follower) throw new NotFoundException('Follower not found');

    await this.followersRepo.delete(follower.id);
    return { deleted: true };
  }

  // ── Attachments ────────────────────────────────────────────────────────────

  async listAttachments(context: RequestContext, projectId: string) {
    await this.projectsCrudService.findOne(context, projectId);
    return this.attachmentsRepo.find({
      where: { tenantId: context.tenantId, workspaceId: context.workspaceId, projectId },
      order: { createdAt: 'DESC' },
    });
  }

  async uploadAttachment(
    context: RequestContext,
    projectId: string,
    file: Express.Multer.File,
  ) {
    await this.projectsCrudService.findOne(context, projectId);

    const count = await this.attachmentsRepo.count({
      where: { tenantId: context.tenantId, workspaceId: context.workspaceId, projectId },
    });

    if (count >= MAX_ATTACHMENTS) {
      throw new BadRequestException(`Maximum of ${MAX_ATTACHMENTS} attachments per project`);
    }

    const ext = file.originalname.split('.').pop() ?? '';
    const storagePath = `tenants/${context.tenantId}/workspaces/${context.workspaceId}/projects/${projectId}/attachments/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const stored = await this.filesService.uploadRawFile({ file, path: storagePath });

    const attachment = this.attachmentsRepo.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      projectId,
      uploadedById: context.userId,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      assetPath: stored.path,
      assetUrl: stored.url,
    });

    return this.attachmentsRepo.save(attachment);
  }

  async deleteAttachment(context: RequestContext, projectId: string, attachmentId: string) {
    await this.projectsCrudService.findOne(context, projectId);

    const attachment = await this.attachmentsRepo.findOne({
      where: {
        id: attachmentId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        projectId,
      },
    });

    if (!attachment) throw new NotFoundException('Attachment not found');

    await this.attachmentsRepo.delete(attachment.id);
    return { deleted: true };
  }
}
