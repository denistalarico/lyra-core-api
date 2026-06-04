import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgencyTaskAttachment } from '../entities';
import { FilesService } from '../../../common/files/files.service';
import { TasksCrudService } from './tasks-crud.service';

type RequestContext = { tenantId: string; workspaceId: string; userId: string };

const MAX_ATTACHMENTS = 10;

@Injectable()
export class TaskAttachmentsService {
  constructor(
    @InjectRepository(AgencyTaskAttachment, 'agency')
    private readonly repo: Repository<AgencyTaskAttachment>,

    private readonly filesService: FilesService,
    private readonly tasksCrudService: TasksCrudService,
  ) {}

  async listAttachments(context: RequestContext, taskId: string) {
    await this.tasksCrudService.findOne(context, taskId);
    return this.repo.find({
      where: { tenantId: context.tenantId, workspaceId: context.workspaceId, taskId },
      order: { createdAt: 'DESC' },
    });
  }

  async uploadAttachment(context: RequestContext, taskId: string, file: Express.Multer.File) {
    await this.tasksCrudService.findOne(context, taskId);

    const count = await this.repo.count({
      where: { tenantId: context.tenantId, workspaceId: context.workspaceId, taskId },
    });

    if (count >= MAX_ATTACHMENTS) {
      throw new BadRequestException(`Maximum of ${MAX_ATTACHMENTS} attachments per task`);
    }

    const ext = file.originalname.split('.').pop() ?? '';
    const storagePath = `tenants/${context.tenantId}/workspaces/${context.workspaceId}/tasks/${taskId}/attachments/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const stored = await this.filesService.uploadRawFile({ file, path: storagePath });

    const attachment = this.repo.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      taskId,
      uploadedById: context.userId,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      assetPath: stored.path,
      assetUrl: stored.url,
    });

    return this.repo.save(attachment);
  }

  async deleteAttachment(context: RequestContext, taskId: string, attachmentId: string) {
    await this.tasksCrudService.findOne(context, taskId);

    const attachment = await this.repo.findOne({
      where: { id: attachmentId, tenantId: context.tenantId, workspaceId: context.workspaceId, taskId },
    });

    if (!attachment) throw new NotFoundException('Attachment not found');

    await this.repo.delete(attachment.id);
    return { deleted: true };
  }
}
