import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import sanitizeHtml from 'sanitize-html';
import { Repository } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { FilesService } from '../../common/files/files.service';
import type { ApprovalCommentContent } from './approval-comment-content';
import type { ApprovalFeedbackDto } from './dto/social-approval.dto';
import {
  SocialApprovalCommentEntity,
  type SocialApprovalCommentAttachment,
} from './entities';

export const APPROVAL_FEEDBACK_MAX_FILES = 5;
const APPROVAL_FEEDBACK_MAX_BYTES = 50 * 1024 * 1024;
const MAX_BODY_LENGTH = 8000;
/** Memory storage: the size is bounded here, before a handler runs. */
export const APPROVAL_FEEDBACK_UPLOAD = {
  limits: {
    fileSize: APPROVAL_FEEDBACK_MAX_BYTES,
    files: APPROVAL_FEEDBACK_MAX_FILES,
  },
};

const DOCUMENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
]);
const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const AUDIO_TYPES = new Set([
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/aac',
  'audio/mpeg',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/webm',
]);

export type ApprovalFeedbackFile = Pick<
  Express.Multer.File,
  'originalname' | 'mimetype' | 'size' | 'buffer'
>;

export type ApprovalFeedbackTargets = {
  /** Every request this reader can decide on the piece, in step order. */
  decide: string[];
  comment: string[];
};

export type ApprovalFeedbackActions = {
  approve: (id: string, notes?: ApprovalCommentContent) => Promise<unknown>;
  changes: (
    id: string,
    content: ApprovalCommentContent,
    kind: 'revise' | 'reject',
  ) => Promise<unknown>;
  comment: (id: string, content: ApprovalCommentContent) => Promise<unknown>;
};

export function sanitizeApprovalRichBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'em',
      's',
      'ul',
      'ol',
      'li',
      'blockquote',
      'a',
    ],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        target: '_blank',
        rel: 'noopener noreferrer',
      }),
    },
  }).trim();
}

/** The plain `body` that notifications and conversation timelines keep using. */
export function approvalRichBodyToText(html: string): string {
  return sanitizeHtml(
    html.replace(/<\/(p|li|blockquote)>|<br\s*\/?>/gi, '\n'),
    {
      allowedTags: [],
      allowedAttributes: {},
    },
  )
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function attachmentKind(mimeType: string) {
  if (IMAGE_TYPES.has(mimeType)) return 'image' as const;
  if (VIDEO_TYPES.has(mimeType)) return 'video' as const;
  if (AUDIO_TYPES.has(mimeType)) return 'audio' as const;
  if (DOCUMENT_TYPES.has(mimeType)) return 'file' as const;
  throw new BadRequestException('Este tipo de arquivo não é aceito.');
}

function displayName(original: string) {
  const name = Buffer.from(original, 'latin1')
    .toString('utf8')
    .replace(/^.*[/\\]/, '')
    .replace(/\p{Cc}/gu, '')
    .trim();
  return name.slice(-160) || 'arquivo';
}

/**
 * One decision over a whole piece. Each surface says which requests the reader
 * may act on and how; the decisions themselves stay in the workflow services,
 * which re-check authority under lock.
 */
@Injectable()
export class SocialApprovalFeedbackService {
  constructor(
    @InjectRepository(SocialApprovalCommentEntity, 'agency')
    private readonly comments: Repository<SocialApprovalCommentEntity>,
    private readonly files: FilesService,
  ) {}

  private mimeType(file: ApprovalFeedbackFile) {
    return file.mimetype.split(';')[0].trim().toLowerCase();
  }

  private async store(
    scope: CompanyAwareScope,
    files: readonly ApprovalFeedbackFile[],
  ): Promise<SocialApprovalCommentAttachment[]> {
    const stored: SocialApprovalCommentAttachment[] = [];
    try {
      for (const file of files) {
        const mimeType = this.mimeType(file);
        const id = randomUUID();
        const fileName = displayName(file.originalname);
        const { path } = await this.files.uploadPrivateBuffer({
          body: file.buffer,
          path: `social-approvals/${scope.tenantId}/feedback/${id}${extname(fileName).toLowerCase()}`,
          contentType: mimeType,
        });
        stored.push({
          id,
          kind: attachmentKind(mimeType),
          fileName,
          mimeType,
          byteSize: String(file.size),
          storagePath: path,
        });
      }
    } catch (error) {
      await this.discard(stored);
      throw error;
    }
    return stored;
  }

  /** Best effort: a leftover object is invisible, a hidden decision error is not. */
  private async discard(attachments: SocialApprovalCommentAttachment[]) {
    await Promise.allSettled(
      attachments.map((attachment) =>
        this.files.deleteObject({
          bucket: 'private',
          path: attachment.storagePath,
        }),
      ),
    );
  }

  async submit(
    scope: CompanyAwareScope,
    input: Pick<ApprovalFeedbackDto, 'decision' | 'richBody' | 'approvalId'>,
    files: readonly ApprovalFeedbackFile[],
    targets: ApprovalFeedbackTargets,
    actions: ApprovalFeedbackActions,
  ): Promise<void> {
    const { decision } = input;
    // `approvalId` narrows the server's own list; it can never add to it.
    const allowed = (
      decision === 'comment' ? targets.comment : targets.decide
    ).filter((id) => !input.approvalId || id === input.approvalId);
    const ids = decision === 'comment' ? allowed.slice(0, 1) : allowed;
    if (ids.length === 0)
      throw new ConflictException('Esta peça não aguarda mais esta ação.');
    if (decision === 'approve') {
      for (const id of ids) await actions.approve(id);
      return;
    }
    files.forEach((file) => attachmentKind(this.mimeType(file)));
    const richBody = sanitizeApprovalRichBody(input.richBody ?? '');
    const text = approvalRichBodyToText(richBody);
    if (!text && files.length === 0)
      throw new BadRequestException(
        'Descreva as considerações ou anexe um arquivo.',
      );
    if (text.length > MAX_BODY_LENGTH)
      throw new BadRequestException('As considerações estão longas demais.');
    const attachments = await this.store(scope, files);
    const content = {
      body:
        text ||
        (attachments.every((item) => item.kind === 'audio')
          ? 'Áudio enviado.'
          : 'Arquivo enviado.'),
      richBody: text ? richBody : null,
      attachments,
      feedbackId: randomUUID(),
    };
    let applied = 0;
    try {
      for (const id of ids) {
        if (decision === 'comment') await actions.comment(id, content);
        else if (decision === 'approve_with_notes')
          await actions.approve(id, content);
        else await actions.changes(id, content, decision);
        applied += 1;
      }
    } catch (error) {
      if (applied === 0) await this.discard(attachments);
      throw error;
    }
  }

  /**
   * Bytes of one attachment. The caller has already proved the request is
   * visible; `visibility` keeps a client away from internal notes' files.
   */
  async openAttachment(
    approvalRequestId: string,
    attachmentId: string,
    visibility?: 'client',
  ) {
    const query = this.comments
      .createQueryBuilder('comment')
      .where('comment.approvalRequestId = :approvalRequestId', {
        approvalRequestId,
      })
      .andWhere('comment.attachments @> CAST(:match AS jsonb)', {
        match: JSON.stringify([{ id: attachmentId }]),
      });
    if (visibility)
      query.andWhere('comment.visibility = :visibility', { visibility });
    const comment = await query.getOne();
    const attachment = comment?.attachments.find(
      (item) => item.id === attachmentId,
    );
    if (!attachment) throw new NotFoundException('Anexo não encontrado.');
    return {
      file: await this.files.getPrivateAsset(attachment.storagePath),
      mimeType: attachment.mimeType,
    };
  }
}
