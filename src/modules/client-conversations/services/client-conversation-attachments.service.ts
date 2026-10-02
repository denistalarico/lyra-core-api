import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { FilesService } from '../../../common/files/files.service';
import {
  inferAttachmentKind,
  validateTeamChatAttachment,
} from '../../team-chat/services/team-chat-media-rules';
import { TeamChatAttachmentKind } from '../../team-chat/enums';
import {
  CLIENT_CONVERSATION_ERROR_CODES,
  isUuid,
  type ClientConversationAttachmentKind,
} from '../client-conversation.types';
import {
  ClientConversationAttachmentEntity,
  ClientConversationMessageEntity,
} from '../entities';
import type {
  ConversationActor,
  ConversationAttachmentView,
} from './client-conversations.service';
import { ClientConversationsService } from './client-conversations.service';
import type { ClientConversationScope } from './client-conversation-access';

const AGENCY_CONNECTION = 'agency';

function attachmentNotFound() {
  return new NotFoundException({
    statusCode: 404,
    error: 'Not Found',
    message: 'Attachment is not available.',
    code: CLIENT_CONVERSATION_ERROR_CODES.attachmentNotFound,
  });
}

/**
 * CCOM1 — attachments of a client conversation.
 *
 * THE MODEL: OPAQUE REF, AUTHENTICATED STREAM (§14–§16)
 * ----------------------------------------------------
 * This domain is born in the AP3 shape rather than the Team Chat shape, which
 * CCOM0.5 §14 left as the explicit instruction for this phase. Concretely:
 *
 *   upload  → bytes validated, stored under a server-chosen path, row created
 *   read    → caller presents the row id; the server re-proves the conversation
 *             and re-derives the path from the row; bytes are streamed
 *
 * No URL, no signed grant, no `publicUrl` column, no `/api/assets/{path}`. The
 * Team Chat had to retrofit an HMAC grant onto a path that had become the
 * capability; here the path never leaves the process, so there is no link to
 * leak, expire or revoke.
 *
 * WHY MIME/SIZE RULES ARE IMPORTED RATHER THAN RE-DECLARED
 * -------------------------------------------------------
 * `team-chat-media-rules.ts` is a pure function with no identity, no scope and
 * no I/O (CCOM0 §15 marked it directly reusable). Copying its allowlists would
 * mean two tables of limits drifting apart; importing it means a tightened rule
 * tightens both surfaces at once. It is the one piece of Team Chat this domain
 * shares, and it shares nothing else.
 */
@Injectable()
export class ClientConversationAttachmentsService {
  constructor(
    @InjectRepository(ClientConversationAttachmentEntity, AGENCY_CONNECTION)
    private readonly attachments: Repository<ClientConversationAttachmentEntity>,
    @InjectRepository(ClientConversationMessageEntity, AGENCY_CONNECTION)
    private readonly messages: Repository<ClientConversationMessageEntity>,
    private readonly conversations: ClientConversationsService,
    private readonly files: FilesService,
  ) {}

  /**
   * Stores a file against a conversation the caller may write to.
   *
   * Authorization happens *before* any byte is written (§16): the conversation
   * is re-proved against the caller's scope and the actor's eligibility is
   * re-checked, so an upload cannot be used as a way to create state in a
   * company the caller cannot reach.
   *
   * The storage path is composed here, from validated scope ids and fresh
   * randomness. The caller supplies a file name, which is used for display and
   * extension checking only — never as part of the key — so a crafted name
   * cannot steer where the object lands.
   */
  async upload(
    scope: ClientConversationScope,
    actor: ConversationActor,
    conversationId: unknown,
    file: {
      originalname?: string;
      mimetype?: string;
      size?: number;
      buffer?: Buffer;
    },
  ): Promise<ConversationAttachmentView> {
    const conversation = await this.conversations.findAccessible(
      scope,
      conversationId,
      { requireActive: true },
    );
    // Re-proves the seat with the same primitive the message path uses.
    await this.conversations.detail(scope, actor, conversation.id);

    if (!file?.buffer?.length || !file.mimetype || !file.originalname) {
      throw new BadRequestException('Arquivo inválido.');
    }

    const kind = inferAttachmentKind(file.mimetype);
    validateTeamChatAttachment({
      kind,
      mimeType: file.mimetype,
      sizeBytes: file.size ?? file.buffer.length,
      fileName: file.originalname,
    });

    const extension = safeExtension(file.originalname);
    const storageKey =
      `tenants/${conversation.tenantId}/workspaces/${conversation.workspaceId}` +
      `/client-conversations/${conversation.id}` +
      `/${Date.now()}-${randomToken()}${extension ? `.${extension}` : ''}`;

    const stored = await this.files.uploadPrivateBuffer({
      body: file.buffer,
      path: storageKey,
      contentType: file.mimetype,
    });

    const saved = await this.attachments.save(
      this.attachments.create({
        tenantId: conversation.tenantId,
        workspaceId: conversation.workspaceId,
        agencyClientId: conversation.agencyClientId,
        companyContextId: conversation.companyContextId,
        conversationId: conversation.id,
        messageId: null,
        uploadedBySurface: actor.surface,
        uploadedByUserId: actor.userId,
        kind: toAttachmentKind(kind),
        fileName: file.originalname.slice(0, 255),
        mimeType: file.mimetype,
        sizeBytes: String(file.size ?? file.buffer.length),
        storageProvider: 'minio',
        storageKey: stored.path,
      }),
    );

    return toAttachmentView(saved);
  }

  /**
   * Binds uploaded files to the message that carries them.
   *
   * Only attachments of the same conversation that are still unbound can be
   * claimed, so a caller cannot staple someone else's file — or a file from
   * another conversation — onto their own message. The `UPDATE ... WHERE`
   * carries the conversation id, so the check is in the statement rather than
   * in a prior read that a race could invalidate.
   */
  async attachToMessage(
    conversationId: string,
    messageId: string,
    attachmentIds: readonly string[],
  ): Promise<ConversationAttachmentView[]> {
    const ids = attachmentIds.filter((id) => typeof id === 'string' && id);
    if (!ids.length) return [];

    await this.attachments.update(
      { id: In(ids), conversationId, messageId: IsNull() },
      { messageId },
    );

    const bound = await this.attachments.find({
      where: { messageId, conversationId },
      order: { createdAt: 'ASC' },
    });

    return bound.map(toAttachmentView);
  }

  /** Attachments of a set of messages, keyed by message id, for projection. */
  async forMessages(
    messageIds: readonly string[],
  ): Promise<Map<string, ConversationAttachmentView[]>> {
    const grouped = new Map<string, ConversationAttachmentView[]>();
    if (!messageIds.length) return grouped;

    const rows = await this.attachments.find({
      where: { messageId: In(messageIds as string[]) },
      order: { createdAt: 'ASC' },
    });

    for (const row of rows) {
      if (!row.messageId) continue;
      const list = grouped.get(row.messageId) ?? [];
      list.push(toAttachmentView(row));
      grouped.set(row.messageId, list);
    }

    return grouped;
  }

  /**
   * Resolves an opaque ref to real bytes.
   *
   * The chain, all fail-closed and in this order (§16/§53):
   *
   *   1. the caller's surface has already proven its scope (guards)
   *   2. the attachment row is loaded by id alone
   *   3. the row's own conversation is re-proved against that scope
   *   4. the storage path is read off the row, never off the request
   *
   * Step 3 is what makes "attachment of company B fetched through company A"
   * impossible: the conversation comes from the row, so the caller cannot name
   * one. A ref from another company therefore answers 404 — the same answer as
   * a ref that does not exist.
   */
  async resolveForStream(
    scope: ClientConversationScope,
    actor: ConversationActor,
    attachmentId: unknown,
  ): Promise<{ storageKey: string; mimeType: string; fileName: string }> {
    /**
     * The ref must be a UUID *before* it reaches a query.
     *
     * Without this, a non-UUID ref — a traversal string, a storage path, any
     * junk — reaches PostgreSQL and raises an uncaught cast error, which
     * surfaces as a 500. A 500 is both a worse answer than 404 (it
     * distinguishes "malformed" from "not yours", which is a weak oracle) and
     * an error the caller can trigger at will. Shape is validated here, and
     * ownership is validated below.
     */
    if (!isUuid(attachmentId)) {
      throw attachmentNotFound();
    }

    const attachment = await this.attachments.findOne({
      where: { id: attachmentId },
    });
    if (!attachment) throw attachmentNotFound();

    // Re-proves the conversation of THIS row against the caller's scope.
    const conversation = await this.conversations
      .findAccessible(scope, attachment.conversationId)
      .catch(() => {
        throw attachmentNotFound();
      });
    await this.conversations.detail(scope, actor, conversation.id);

    // A bound attachment must still belong to a message of that conversation.
    if (attachment.messageId) {
      const message = await this.messages.findOne({
        where: { id: attachment.messageId, conversationId: conversation.id },
      });
      if (!message) throw attachmentNotFound();
    }

    return {
      storageKey: attachment.storageKey,
      mimeType: attachment.mimeType,
      fileName: attachment.fileName,
    };
  }
}

function toAttachmentView(
  row: ClientConversationAttachmentEntity,
): ConversationAttachmentView {
  return {
    id: row.id,
    kind: row.kind,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: Number(row.sizeBytes),
    width: row.width,
    height: row.height,
  };
}

/**
 * `OTHER` is rejected by `validateTeamChatAttachment` before this is reached,
 * so the fallback exists only to keep the mapping total.
 */
function toAttachmentKind(
  kind: TeamChatAttachmentKind,
): ClientConversationAttachmentKind {
  switch (kind) {
    case TeamChatAttachmentKind.IMAGE:
      return 'image';
    case TeamChatAttachmentKind.VIDEO:
      return 'video';
    case TeamChatAttachmentKind.AUDIO:
      return 'audio';
    default:
      return 'document';
  }
}

function safeExtension(fileName: string): string {
  const raw = fileName.split('.').pop()?.toLowerCase() ?? '';
  // Only a plain alphanumeric suffix is carried into the key; anything else is
  // dropped rather than sanitized, so no separator can survive into the path.
  return /^[a-z0-9]{1,8}$/.test(raw) ? raw : '';
}

function randomToken(): string {
  return Math.random().toString(36).slice(2, 10);
}
