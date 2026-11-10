import type { SocialApprovalCommentAttachment } from './entities';

/** What a comment may carry beyond its plain text. */
export type ApprovalCommentContent =
  | string
  | {
      body: string;
      richBody?: string | null;
      attachments?: SocialApprovalCommentAttachment[];
      feedbackId?: string | null;
    };

/** The storage path stays on the server, for the agency too. */
export function publicApprovalAttachments(
  attachments: readonly SocialApprovalCommentAttachment[] | null | undefined,
) {
  return (attachments ?? []).map((attachment) => ({
    id: attachment.id,
    kind: attachment.kind,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    byteSize: attachment.byteSize,
  }));
}
