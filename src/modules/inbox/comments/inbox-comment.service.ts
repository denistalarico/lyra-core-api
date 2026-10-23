import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import type { NormalizedMetaComment } from '../channels/meta/adapters/meta-comment.normalizer';
import { InboxChannelEntity } from '../entities/inbox-channel.entity';
import { InboxCommentContentEntity } from '../entities/inbox-comment-content.entity';
import {
  InboxCommentEntity,
  type InboxCommentReplyStatus,
} from '../entities/inbox-comment.entity';
import { InboxConversationEntity } from '../entities/inbox-conversation.entity';
import { resolveInboxCompanyScope } from '../inbox-company-scope';
import { hasLeadFlowOutboundOptOut } from '../services/leadflow-contact-opt-out';
import {
  InboxCommentGraphClient,
  InboxCommentGraphError,
  type InboxCommentChannelAccess,
} from './inbox-comment-graph.client';
import { SocialAdStoryLookupRegistry } from './social-ad-story-lookup.port';

/** Meta: one private reply per comment, within 7 days of the comment. */
export const COMMENT_PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CONTENT_TTL_MS = 24 * 60 * 60 * 1000;
/** Meta CDN links (IG media, FB pictures) expire in about 5 days. */
const THUMBNAIL_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;
export const MAX_COMMENT_REPLY_LENGTH = 1000;

export type InboxCommentActor =
  | { type: 'user'; userId: string | null }
  | { type: 'agent'; agentId: string };

export type InboxCommentListFilters = {
  channelType?: string;
  replyStatus?: string;
  contentId?: string;
  onlyAds?: boolean;
  cursor?: string;
  limit?: number;
};

type CommentRow = InboxCommentEntity & {
  channelType: string;
  content: InboxCommentContentEntity | null;
};

/**
 * Post and ad comments in the LeadFlow Inbox (IX3, D-IX-5/D-IX-11).
 *
 * Every Meta write goes through here with the token of the **Inbox channel**
 * (D-IX-12), after the scope, the 7-day/one-private-reply rule and the
 * author's opt-out are checked. A provider failure is mapped to a safe code
 * and never swallowed.
 */
@Injectable()
export class InboxCommentService {
  private readonly logger = new Logger(InboxCommentService.name);

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly crypto: SettingsCryptoService,
    private readonly graph: InboxCommentGraphClient,
    private readonly storyLookup: SocialAdStoryLookupRegistry,
  ) {}

  // ---------------------------------------------------------------- ingest

  /**
   * Idempotent on the provider id. Our own replies come back on the webhook:
   * the UNIQUE key folds the echo into the row the reply created, and a row
   * the account wrote outside the Lyra lands as `outbound`.
   */
  async ingest(
    channel: InboxChannelEntity,
    comment: NormalizedMetaComment,
  ): Promise<{ comment: InboxCommentEntity | null; created: boolean }> {
    const repository = this.dataSource.getRepository(InboxCommentEntity);
    const existing = await repository.findOneBy({
      tenantId: channel.tenantId,
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      externalCommentId: comment.externalCommentId,
    });
    if (comment.lifecycle !== 'created' && comment.lifecycle !== 'updated') {
      if (!existing) return { comment: null, created: false };
      existing.status =
        comment.lifecycle === 'removed'
          ? 'deleted'
          : comment.lifecycle === 'hidden'
            ? 'hidden'
            : 'active';
      if (comment.lifecycle === 'removed') existing.text = null;
      return { comment: await repository.save(existing), created: false };
    }
    if (existing) {
      if (comment.lifecycle === 'updated' && comment.text !== null) {
        existing.text = comment.text;
      }
      existing.authorUsername ??= comment.authorUsername;
      existing.authorName ??= comment.authorName;
      existing.externalContentId ??= comment.externalContentId;
      existing.adExternalId ??= comment.adExternalId;
      existing.adTitle ??= comment.adTitle;
      if (existing.contentKind === 'unknown') {
        existing.contentKind = comment.contentKind;
      }
      return { comment: await repository.save(existing), created: false };
    }

    const direction = comment.fromOwnAccount ? 'outbound' : 'inbound';
    const [row] = await this.dataSource.query<Array<{ id: string }>>(
      `INSERT INTO inbox_comments (
         tenant_id, workspace_id, agency_client_id, company_context_id,
         scope_kind, channel_id, surface, account_external_id,
         external_comment_id, external_parent_id, external_content_id,
         content_kind, ad_external_id, ad_title, author_external_id,
         author_username, author_name, text, direction, reply_status,
         provider_created_at, occurred_at, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       ON CONFLICT (tenant_id, workspace_id, channel_id, external_comment_id)
       DO NOTHING
       RETURNING id`,
      [
        channel.tenantId,
        channel.workspaceId,
        channel.agencyClientId,
        channel.companyContextId,
        channel.scopeKind,
        channel.id,
        comment.surface,
        comment.accountExternalId,
        comment.externalCommentId,
        comment.externalParentId,
        comment.externalContentId,
        comment.contentKind,
        comment.adExternalId,
        comment.adTitle,
        comment.authorExternalId,
        comment.authorUsername,
        comment.authorName,
        comment.text,
        direction,
        direction === 'outbound' ? 'answered' : 'unanswered',
        comment.providerCreatedAt,
        comment.occurredAt,
        JSON.stringify(comment.metadata),
      ],
    );
    const saved = await repository.findOneByOrFail({
      tenantId: channel.tenantId,
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      externalCommentId: comment.externalCommentId,
    });
    await this.ensureContentRow(channel, saved);
    if (row && direction === 'outbound' && saved.externalParentId) {
      // The account answered (natively or through us): the parent is answered.
      await this.markAnsweredByExternalId(channel, saved.externalParentId);
    }
    return { comment: saved, created: Boolean(row) };
  }

  // ------------------------------------------------------------------ read

  async list(ctx: RequestContext, filters: InboxCommentListFilters) {
    const scope = resolveInboxCompanyScope(ctx);
    const limit = Math.min(Math.max(filters.limit ?? 30, 1), 100);
    const params: unknown[] = [
      scope.tenantId,
      scope.workspaceId,
      scope.scopeKind,
      scope.agencyClientId,
      scope.companyContextId,
    ];
    const where = [
      'c.tenant_id = $1',
      'c.workspace_id = $2',
      'c.scope_kind = $3',
      'c.agency_client_id IS NOT DISTINCT FROM $4',
      'c.company_context_id IS NOT DISTINCT FROM $5',
      "c.direction = 'inbound'",
      "c.status <> 'deleted'",
    ];
    const surface = surfaceFilter(filters.channelType);
    if (surface) {
      params.push(surface);
      where.push(`c.surface = $${params.length}`);
    }
    if (filters.replyStatus) {
      if (!['unanswered', 'answered', 'ignored'].includes(filters.replyStatus))
        throw new BadRequestException('comment_reply_status_invalid');
      params.push(filters.replyStatus);
      where.push(`c.reply_status = $${params.length}`);
    }
    if (filters.contentId) {
      params.push(filters.contentId.slice(0, 180));
      where.push(`c.external_content_id = $${params.length}`);
    }
    if (filters.onlyAds) {
      where.push(
        "(c.content_kind = 'ad' OR c.ad_external_id IS NOT NULL OR ct.is_published = false)",
      );
    }
    const cursor = decodeCursor(filters.cursor);
    if (cursor) {
      params.push(cursor.occurredAt, cursor.id);
      where.push(
        `(c.occurred_at, c.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }
    params.push(limit + 1);
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT c.id
         FROM inbox_comments c
         LEFT JOIN inbox_comment_contents ct
           ON ct.tenant_id = c.tenant_id AND ct.workspace_id = c.workspace_id
          AND ct.channel_id = c.channel_id
          AND ct.external_content_id = c.external_content_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.occurred_at DESC, c.id DESC
        LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, limit).map((row) => String(row.id));
    const loaded = await this.loadRows(scope.tenantId, scope.workspaceId, page);
    const roots = await this.rootIds(loaded);
    const items = page
      .map((id) => loaded.get(id))
      .filter((row): row is CommentRow => Boolean(row))
      .map((row) => this.toItem(row, roots.get(row.id) ?? null));
    const last = loaded.get(page[page.length - 1] ?? '');
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? encodeCursor(last.occurredAt, last.id)
          : null,
    };
  }

  async getThread(ctx: RequestContext, id: string) {
    const comment = await this.findInScope(ctx, id);
    const channel = await this.findChannel(comment);
    const root = comment.externalParentId
      ? ((await this.dataSource.getRepository(InboxCommentEntity).findOneBy({
          tenantId: comment.tenantId,
          workspaceId: comment.workspaceId,
          channelId: comment.channelId,
          externalCommentId: comment.externalParentId,
        })) ?? comment)
      : comment;
    const replies = await this.dataSource
      .getRepository(InboxCommentEntity)
      .find({
        where: {
          tenantId: root.tenantId,
          workspaceId: root.workspaceId,
          channelId: root.channelId,
          externalParentId: root.externalCommentId,
        },
        order: { occurredAt: 'ASC', id: 'ASC' },
        take: 200,
      });
    let contentError: string | null = null;
    let content: InboxCommentContentEntity | null = null;
    if (root.externalContentId) {
      const resolved = await this.resolveContent(
        channel,
        root.externalContentId,
      );
      content = resolved.content;
      contentError = resolved.errorCode;
    }
    const linked = await this.linkPrivateReplyConversations(
      [root, ...replies].filter(
        (row) =>
          row.privateReplyStatus === 'sent' && !row.privateReplyConversationId,
      ),
    );
    const decorate = (row: InboxCommentEntity) =>
      this.toItem(
        {
          ...(linked.get(row.id) ?? row),
          channelType: channel.type,
          content,
        } as CommentRow,
        row.id === root.id ? null : root.id,
      );
    return {
      root: decorate(root),
      replies: replies.map(decorate),
      selectedId: comment.id,
      content: content ? this.toContent(content) : null,
      contentError,
    };
  }

  /** The API shape of one comment (the same as a list item). */
  async present(comment: InboxCommentEntity) {
    const rows = await this.loadRows(comment.tenantId, comment.workspaceId, [
      comment.id,
    ]);
    const row = rows.get(comment.id);
    if (!row) throw new NotFoundException('Comment not found.');
    const roots = await this.rootIds(rows);
    return this.toItem(row, roots.get(comment.id) ?? null);
  }

  // ----------------------------------------------------------------- write

  async replyPublic(
    ctx: RequestContext,
    id: string,
    text: string,
    idempotencyKey: string,
    actor: InboxCommentActor,
  ) {
    const comment = await this.findInScope(ctx, id);
    return this.replyPublicTo(comment, text, idempotencyKey, actor);
  }

  /** Shared with the comment agent, which has no request context. */
  async replyPublicTo(
    comment: InboxCommentEntity,
    text: string,
    idempotencyKey: string,
    actor: InboxCommentActor,
  ) {
    const body = replyText(text);
    const key = idempotencyKeyOf(idempotencyKey);
    if (comment.status === 'deleted') {
      throw new ConflictException('comment_deleted');
    }
    const channel = await this.findChannel(comment, true);
    const access = this.access(channel);
    // The thread's top-level comment: Instagram only accepts replies there,
    // and Facebook files a reply-to-a-reply under the same parent anyway.
    const target = comment.externalParentId ?? comment.externalCommentId;

    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `inbox-comment-reply:${comment.tenantId}:${key}`,
      ]);
      const replayed = await manager
        .getRepository(InboxCommentEntity)
        .findOneBy({
          tenantId: comment.tenantId,
          workspaceId: comment.workspaceId,
          idempotencyKey: key,
        });
      if (replayed) return { comment: replayed, replayed: true };

      const published = await this.callGraph(() =>
        this.graph.replyPublic(access, target, body),
      );
      await manager.query(
        `INSERT INTO inbox_comments (
           tenant_id, workspace_id, agency_client_id, company_context_id,
           scope_kind, channel_id, surface, account_external_id,
           external_comment_id, external_parent_id, external_content_id,
           content_kind, ad_external_id, ad_title, text, direction,
           author_user_id, author_agent_id, reply_status, occurred_at,
           metadata, idempotency_key
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'outbound',$16,$17,'answered',now(),$18,$19)
         ON CONFLICT (tenant_id, workspace_id, channel_id, external_comment_id)
         DO UPDATE SET direction = 'outbound',
                       author_user_id = EXCLUDED.author_user_id,
                       author_agent_id = EXCLUDED.author_agent_id,
                       idempotency_key = EXCLUDED.idempotency_key,
                       text = COALESCE(inbox_comments.text, EXCLUDED.text),
                       updated_at = now()`,
        [
          comment.tenantId,
          comment.workspaceId,
          comment.agencyClientId,
          comment.companyContextId,
          comment.scopeKind,
          comment.channelId,
          comment.surface,
          comment.accountExternalId,
          published.id,
          target,
          comment.externalContentId,
          comment.contentKind,
          comment.adExternalId,
          comment.adTitle,
          body,
          actor.type === 'user' ? actor.userId : null,
          actor.type === 'agent' ? actor.agentId : null,
          JSON.stringify({ source: 'lyra', actorType: actor.type }),
          key,
        ],
      );
      if (comment.direction === 'inbound') {
        await manager.update(
          InboxCommentEntity,
          { id: comment.id },
          { replyStatus: 'answered' },
        );
      }
      const reply = await manager
        .getRepository(InboxCommentEntity)
        .findOneByOrFail({
          tenantId: comment.tenantId,
          workspaceId: comment.workspaceId,
          channelId: comment.channelId,
          externalCommentId: published.id,
        });
      return { comment: reply, replayed: false };
    });
  }

  async replyPrivate(
    ctx: RequestContext,
    id: string,
    text: string,
    idempotencyKey: string,
    actor: InboxCommentActor,
  ) {
    const comment = await this.findInScope(ctx, id);
    return this.replyPrivateTo(comment, text, idempotencyKey, actor);
  }

  async replyPrivateTo(
    comment: InboxCommentEntity,
    text: string,
    idempotencyKey: string,
    actor: InboxCommentActor,
  ) {
    const body = replyText(text);
    const key = idempotencyKeyOf(idempotencyKey);
    const channel = await this.findChannel(comment, true);
    const access = this.access(channel);

    // The failure is recorded after the transaction: inside it, the rollback
    // that the rethrow causes would erase the record of the attempt.
    let failure: unknown = null;
    const outcome = await this.dataSource.transaction(async (manager) => {
      const locked = await manager
        .getRepository(InboxCommentEntity)
        .createQueryBuilder('comment')
        .setLock('pessimistic_write')
        .where('comment.id = :id AND comment.tenant_id = :tenantId', {
          id: comment.id,
          tenantId: comment.tenantId,
        })
        .getOneOrFail();
      const previous = record(locked.metadata.privateReply);
      if (locked.privateReplyStatus === 'sent') {
        if (previous?.idempotencyKey === key) {
          return { comment: locked, replayed: true };
        }
        throw new ConflictException('comment_private_reply_already_sent');
      }
      assertPrivateReplyAllowed(locked);
      const conversation = await this.findAuthorConversation(locked, manager);
      if (conversation && hasLeadFlowOutboundOptOut(conversation)) {
        throw new ConflictException('comment_author_opted_out');
      }

      let sent: { messageId: string | null };
      try {
        sent = await this.callGraph(() =>
          this.graph.replyPrivate(access, locked.externalCommentId, body),
        );
      } catch (error) {
        failure = error;
        return null;
      }
      const now = new Date();
      locked.privateReplyStatus = 'sent';
      locked.privateReplyAt = now;
      locked.replyStatus = 'answered';
      locked.privateReplyConversationId = conversation?.id ?? null;
      locked.metadata = {
        ...locked.metadata,
        privateReply: {
          status: 'sent',
          idempotencyKey: key,
          actorType: actor.type,
          userId: actor.type === 'user' ? actor.userId : null,
          agentId: actor.type === 'agent' ? actor.agentId : null,
          messageId: sent.messageId,
          at: now.toISOString(),
        },
      };
      const saved = await manager.save(locked);
      if (conversation) {
        await this.markConversationOrigin(saved, conversation.id, manager);
      }
      return { comment: saved, replayed: false };
    });
    if (outcome) return outcome;

    await this.dataSource.query(
      `UPDATE inbox_comments
          SET private_reply_status = 'failed',
              metadata = metadata || jsonb_build_object('privateReply', $3::jsonb),
              updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND private_reply_status <> 'sent'`,
      [
        comment.id,
        comment.tenantId,
        JSON.stringify({
          status: 'failed',
          errorCode: errorCodeOf(failure),
          actorType: actor.type,
          at: new Date().toISOString(),
        }),
      ],
    );
    throw failure;
  }

  async setHidden(ctx: RequestContext, id: string, hidden: boolean) {
    const comment = await this.findInScope(ctx, id);
    if (comment.status === 'deleted') {
      throw new ConflictException('comment_deleted');
    }
    const channel = await this.findChannel(comment, true);
    await this.callGraph(() =>
      this.graph.setHidden(
        this.access(channel),
        comment.externalCommentId,
        hidden,
      ),
    );
    comment.status = hidden ? 'hidden' : 'active';
    comment.metadata = withModeration(
      comment.metadata,
      hidden ? 'hide' : 'unhide',
      ctx.userId ?? null,
    );
    return this.dataSource.getRepository(InboxCommentEntity).save(comment);
  }

  /** D-IX-11: irreversible on Meta; the route is Owner/Admin and audited. */
  async remove(ctx: RequestContext, id: string) {
    const comment = await this.findInScope(ctx, id);
    if (comment.status === 'deleted') return comment;
    const channel = await this.findChannel(comment, true);
    await this.callGraph(() =>
      this.graph.remove(this.access(channel), comment.externalCommentId),
    );
    comment.status = 'deleted';
    comment.text = null;
    comment.metadata = withModeration(
      comment.metadata,
      'delete',
      ctx.userId ?? null,
    );
    this.logger.log({
      event: 'inbox_comment_deleted',
      commentId: comment.id,
      channelId: comment.channelId,
      userId: ctx.userId ?? null,
    });
    return this.dataSource.getRepository(InboxCommentEntity).save(comment);
  }

  async setReplyStatus(
    ctx: RequestContext,
    id: string,
    status: InboxCommentReplyStatus,
  ) {
    const comment = await this.findInScope(ctx, id);
    comment.replyStatus = status;
    return this.dataSource.getRepository(InboxCommentEntity).save(comment);
  }

  // --------------------------------------------------------------- content

  /**
   * The post/ad a comment sits on, cached for 24h. A Graph failure keeps the
   * cached row and reports the safe code; the comment itself never fails.
   */
  async resolveContent(
    channel: InboxChannelEntity,
    externalContentId: string,
    options: { force?: boolean } = {},
  ): Promise<{
    content: InboxCommentContentEntity | null;
    errorCode: string | null;
  }> {
    const repository = this.dataSource.getRepository(InboxCommentContentEntity);
    const cached = await repository.findOneBy({
      tenantId: channel.tenantId,
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      externalContentId,
    });
    if (
      !options.force &&
      cached?.fetchedAt &&
      Date.now() - cached.fetchedAt.getTime() < CONTENT_TTL_MS
    ) {
      return { content: cached, errorCode: null };
    }
    let access: InboxCommentChannelAccess;
    try {
      access = this.access(channel);
    } catch (error) {
      return { content: cached, errorCode: errorCodeOf(error) };
    }
    try {
      const read = await this.graph.readContent(access, externalContentId);
      const row =
        cached ??
        repository.create({
          tenantId: channel.tenantId,
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          externalContentId,
          adExternalId: null,
          adName: null,
          campaignName: null,
        });
      row.contentKind = cached?.contentKind === 'ad' ? 'ad' : read.contentKind;
      row.permalink = read.permalink;
      row.caption = read.caption;
      row.thumbnailUrl = read.thumbnailUrl;
      row.isPublished = read.isPublished;
      row.providerCreatedAt = read.providerCreatedAt;
      row.fetchedAt = new Date();
      if (
        access.surface === 'facebook' &&
        (read.isPublished === false || row.contentKind === 'ad')
      ) {
        const story = await this.lookupAdStory(channel, externalContentId);
        if (story) {
          row.contentKind = 'ad';
          row.adExternalId = story.adId;
          row.adName = story.adName;
          row.campaignName = story.campaignName;
        }
      }
      return { content: await repository.save(row), errorCode: null };
    } catch (error) {
      return { content: cached, errorCode: errorCodeOf(error) };
    }
  }

  // ------------------------------------------------------ conversation link

  /**
   * The lead answers a private reply in the Direct/Messenger thread with the
   * same scoped id the comment carried (to be confirmed in the smoke). The
   * link is made lazily — on read and by the reconciliation — so the
   * messaging path is not touched.
   */
  async linkPrivateReplyConversations(
    comments: InboxCommentEntity[],
  ): Promise<Map<string, InboxCommentEntity>> {
    const linked = new Map<string, InboxCommentEntity>();
    for (const comment of comments) {
      const conversation = await this.findAuthorConversation(comment);
      if (!conversation) continue;
      await this.dataSource.transaction(async (manager) => {
        await manager.update(
          InboxCommentEntity,
          { id: comment.id, privateReplyConversationId: IsNull() },
          { privateReplyConversationId: conversation.id },
        );
        await this.markConversationOrigin(comment, conversation.id, manager);
      });
      linked.set(comment.id, {
        ...comment,
        privateReplyConversationId: conversation.id,
      } as InboxCommentEntity);
    }
    return linked;
  }

  /** What the agent's exclusions need to know about the comment's author. */
  async authorSignals(
    comment: InboxCommentEntity,
  ): Promise<{ optOut: boolean; internal: boolean }> {
    const conversation = await this.findAuthorConversation(comment);
    return {
      optOut: hasLeadFlowOutboundOptOut(conversation),
      internal: conversation?.qualificationStatus === 'internal',
    };
  }

  /** Comments with a private reply sent and no conversation yet (bounded). */
  async linkPendingPrivateReplies(limit = 50): Promise<number> {
    const pending = await this.dataSource
      .getRepository(InboxCommentEntity)
      .find({
        where: {
          privateReplyStatus: 'sent',
          privateReplyConversationId: IsNull(),
        },
        order: { privateReplyAt: 'DESC' },
        take: limit,
      });
    return (await this.linkPrivateReplyConversations(pending)).size;
  }

  // -------------------------------------------------------------- helpers

  async findChannel(comment: InboxCommentEntity, requireActive = false) {
    const channel = await this.dataSource
      .getRepository(InboxChannelEntity)
      .findOneBy({
        id: comment.channelId,
        tenantId: comment.tenantId,
        workspaceId: comment.workspaceId,
        deletedAt: IsNull(),
      });
    if (!channel) throw new NotFoundException('Comment not found.');
    if (
      requireActive &&
      (channel.status !== 'active' || channel.connectionStatus !== 'connected')
    ) {
      throw new ConflictException('comment_channel_unavailable');
    }
    return channel;
  }

  access(channel: InboxChannelEntity): InboxCommentChannelAccess {
    const token = channel.accessTokenEncrypted
      ? this.crypto.decrypt(channel.accessTokenEncrypted)
      : null;
    if (!token) throw new ConflictException('comment_channel_token_missing');
    const access = InboxCommentGraphClient.accessFor(channel, token);
    if (!access) throw new ConflictException('comment_channel_unsupported');
    return access;
  }

  private async findInScope(ctx: RequestContext, id: string) {
    const scope = resolveInboxCompanyScope(ctx);
    const comment = await this.dataSource
      .getRepository(InboxCommentEntity)
      .findOneBy({
        id,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        scopeKind: scope.scopeKind,
        agencyClientId: scope.agencyClientId ?? IsNull(),
        companyContextId: scope.companyContextId ?? IsNull(),
      });
    if (!comment) throw new NotFoundException('Comment not found.');
    return comment;
  }

  /** The author's Direct/Messenger conversation on this channel, if any. */
  private async findAuthorConversation(
    comment: InboxCommentEntity,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<InboxConversationEntity | null> {
    if (!comment.authorExternalId) return null;
    return manager
      .getRepository(InboxConversationEntity)
      .createQueryBuilder('conversation')
      .where(
        'conversation.tenant_id = :tenantId AND conversation.workspace_id = :workspaceId AND conversation.channel_id = :channelId',
        {
          tenantId: comment.tenantId,
          workspaceId: comment.workspaceId,
          channelId: comment.channelId,
        },
      )
      .andWhere(
        "right(conversation.external_thread_id, length(:author) + 1) = ':' || :author",
        { author: comment.authorExternalId },
      )
      .orderBy('conversation.created_at', 'DESC')
      .getOne();
  }

  private async markConversationOrigin(
    comment: InboxCommentEntity,
    conversationId: string,
    manager: EntityManager,
  ) {
    await manager.query(
      `UPDATE inbox_conversations
          SET metadata = metadata || jsonb_build_object('origin', $3::jsonb)
        WHERE id = $1 AND tenant_id = $2 AND NOT (metadata ? 'origin')`,
      [
        conversationId,
        comment.tenantId,
        JSON.stringify({
          type: 'comment',
          commentId: comment.id,
          contentId: comment.externalContentId,
          adId: comment.adExternalId,
        }),
      ],
    );
  }

  private async ensureContentRow(
    channel: InboxChannelEntity,
    comment: InboxCommentEntity,
  ) {
    if (!comment.externalContentId) return;
    await this.dataSource.query(
      `INSERT INTO inbox_comment_contents
         (tenant_id, workspace_id, channel_id, external_content_id,
          content_kind, ad_external_id, ad_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, workspace_id, channel_id, external_content_id)
       DO UPDATE SET
         ad_external_id = COALESCE(inbox_comment_contents.ad_external_id, EXCLUDED.ad_external_id),
         ad_name = COALESCE(inbox_comment_contents.ad_name, EXCLUDED.ad_name),
         content_kind = CASE WHEN inbox_comment_contents.content_kind = 'unknown'
                             THEN EXCLUDED.content_kind
                             ELSE inbox_comment_contents.content_kind END`,
      [
        channel.tenantId,
        channel.workspaceId,
        channel.id,
        comment.externalContentId,
        comment.contentKind,
        comment.adExternalId,
        comment.adTitle,
      ],
    );
  }

  private async markAnsweredByExternalId(
    channel: InboxChannelEntity,
    externalCommentId: string,
  ) {
    await this.dataSource.query(
      `UPDATE inbox_comments SET reply_status = 'answered', updated_at = now()
        WHERE tenant_id = $1 AND workspace_id = $2 AND channel_id = $3
          AND external_comment_id = $4 AND direction = 'inbound'
          AND reply_status = 'unanswered'`,
      [channel.tenantId, channel.workspaceId, channel.id, externalCommentId],
    );
  }

  private async lookupAdStory(channel: InboxChannelEntity, storyId: string) {
    const port = this.storyLookup.get();
    if (!port) return null;
    try {
      return await port.findByStoryId({
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        storyId,
      });
    } catch (error) {
      // Enrichment only: the comment keeps "Post patrocinado", and the
      // failure is reported, not hidden.
      this.logger.warn({
        event: 'social_ad_story_lookup_failed',
        channelId: channel.id,
        errorClass: error instanceof Error ? error.name : 'unknown',
      });
      return null;
    }
  }

  private async callGraph<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof InboxCommentGraphError) {
        throw error.code === 'meta_comment_private_reply_unavailable'
          ? new ConflictException(error.code)
          : new BadGatewayException(error.code);
      }
      throw error;
    }
  }

  private async loadRows(
    tenantId: string,
    workspaceId: string,
    ids: string[],
  ): Promise<Map<string, CommentRow>> {
    if (!ids.length) return new Map();
    const comments = await this.dataSource
      .getRepository(InboxCommentEntity)
      .createQueryBuilder('comment')
      .where(
        'comment.tenant_id = :tenantId AND comment.workspace_id = :workspaceId AND comment.id IN (:...ids)',
        { tenantId, workspaceId, ids },
      )
      .getMany();
    const channelIds = [...new Set(comments.map((c) => c.channelId))];
    const channels = await this.dataSource
      .getRepository(InboxChannelEntity)
      .createQueryBuilder('channel')
      .select(['channel.id', 'channel.type'])
      .where('channel.id IN (:...channelIds)', { channelIds })
      .getMany();
    const typeById = new Map(channels.map((c) => [c.id, c.type as string]));
    const contentIds = [
      ...new Set(
        comments
          .map((c) => c.externalContentId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const contents = contentIds.length
      ? await this.dataSource
          .getRepository(InboxCommentContentEntity)
          .createQueryBuilder('content')
          .where(
            'content.tenant_id = :tenantId AND content.workspace_id = :workspaceId AND content.external_content_id IN (:...contentIds)',
            { tenantId, workspaceId, contentIds },
          )
          .getMany()
      : [];
    const contentByKey = new Map(
      contents.map((c) => [`${c.channelId}:${c.externalContentId}`, c]),
    );
    return new Map(
      comments.map((comment) => [
        comment.id,
        {
          ...comment,
          channelType: typeById.get(comment.channelId) ?? 'unknown',
          content: comment.externalContentId
            ? (contentByKey.get(
                `${comment.channelId}:${comment.externalContentId}`,
              ) ?? null)
            : null,
        } as CommentRow,
      ]),
    );
  }

  /** Row id of each reply's top-level comment, when it is known locally. */
  private async rootIds(
    rows: Map<string, CommentRow>,
  ): Promise<Map<string, string>> {
    const replies = [...rows.values()].filter((row) => row.externalParentId);
    const result = new Map<string, string>();
    for (const reply of replies) {
      const root = await this.dataSource
        .getRepository(InboxCommentEntity)
        .findOne({
          select: ['id'],
          where: {
            tenantId: reply.tenantId,
            workspaceId: reply.workspaceId,
            channelId: reply.channelId,
            externalCommentId: reply.externalParentId!,
          },
        });
      if (root) result.set(reply.id, root.id);
    }
    return result;
  }

  private toItem(row: CommentRow, rootCommentId: string | null) {
    const occurred = row.providerCreatedAt ?? row.occurredAt;
    const privateDeadline = new Date(
      occurred.getTime() + COMMENT_PRIVATE_REPLY_WINDOW_MS,
    );
    const privateAvailable =
      row.direction === 'inbound' &&
      row.status !== 'deleted' &&
      row.privateReplyStatus !== 'sent' &&
      privateDeadline.getTime() > Date.now();
    const content = row.content;
    const isAd = Boolean(
      row.contentKind === 'ad' ||
      row.adExternalId ||
      content?.contentKind === 'ad' ||
      content?.isPublished === false,
    );
    return {
      id: row.id,
      channelId: row.channelId,
      channelType: row.channelType,
      surface: row.surface,
      direction: row.direction,
      author: {
        username: row.authorUsername,
        name: row.authorName,
        avatarUrl: row.authorAvatarUrl,
        // D-IX-1: a provider id is never a name.
        displayName:
          row.authorName ??
          (row.authorUsername ? `@${row.authorUsername}` : null) ??
          (row.direction === 'outbound'
            ? 'Sua página'
            : row.surface === 'instagram'
              ? 'Pessoa no Instagram'
              : 'Pessoa no Facebook'),
        isOwnAccount: row.direction === 'outbound',
        userId: row.authorUserId,
        agentId: row.authorAgentId,
      },
      text: row.text,
      status: row.status,
      replyStatus: row.replyStatus,
      privateReply: {
        status: row.privateReplyStatus,
        available: privateAvailable,
        availableUntil:
          row.direction === 'inbound' && row.privateReplyStatus !== 'sent'
            ? privateDeadline.toISOString()
            : null,
        sentAt: row.privateReplyAt?.toISOString() ?? null,
        conversationId: row.privateReplyConversationId,
      },
      isReply: Boolean(row.externalParentId),
      rootCommentId,
      contentKind: content?.contentKind ?? row.contentKind,
      isAd,
      ad: isAd
        ? {
            externalId: content?.adExternalId ?? row.adExternalId,
            name: content?.adName ?? row.adTitle,
            campaignName: content?.campaignName ?? null,
          }
        : null,
      content: content ? this.toContent(content) : null,
      occurredAt: occurred.toISOString(),
    };
  }

  private toContent(content: InboxCommentContentEntity) {
    const fresh =
      content.fetchedAt &&
      Date.now() - content.fetchedAt.getTime() < THUMBNAIL_MAX_AGE_MS;
    return {
      externalId: content.externalContentId,
      kind: content.contentKind,
      permalink: content.permalink,
      caption: content.caption ? content.caption.slice(0, 280) : null,
      thumbnailUrl: fresh ? content.thumbnailUrl : null,
      isPublished: content.isPublished,
      isSponsored:
        content.contentKind === 'ad' || content.isPublished === false,
      ad: content.adExternalId
        ? {
            externalId: content.adExternalId,
            name: content.adName,
            campaignName: content.campaignName,
          }
        : null,
    };
  }
}

export function assertPrivateReplyAllowed(comment: InboxCommentEntity) {
  if (comment.direction !== 'inbound') {
    throw new ConflictException('comment_private_reply_not_inbound');
  }
  if (comment.status === 'deleted') {
    throw new ConflictException('comment_deleted');
  }
  if (!comment.authorExternalId) {
    throw new ConflictException('comment_author_unknown');
  }
  const occurred = comment.providerCreatedAt ?? comment.occurredAt;
  if (Date.now() - occurred.getTime() > COMMENT_PRIVATE_REPLY_WINDOW_MS) {
    throw new ConflictException('comment_private_reply_expired');
  }
}

function replyText(value: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new BadRequestException('comment_reply_text_required');
  if (text.length > MAX_COMMENT_REPLY_LENGTH) {
    throw new BadRequestException('comment_reply_text_too_long');
  }
  return text;
}

function idempotencyKeyOf(value: string): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key.length > 200) {
    throw new BadRequestException('comment_idempotency_key_required');
  }
  return key;
}

function surfaceFilter(value: string | undefined) {
  if (!value) return null;
  if (value === 'instagram') return 'instagram';
  if (value === 'facebook' || value === 'facebook_messenger') return 'facebook';
  throw new BadRequestException('comment_channel_type_invalid');
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function withModeration(
  metadata: Record<string, unknown>,
  action: 'hide' | 'unhide' | 'delete',
  userId: string | null,
) {
  const history = Array.isArray(metadata.moderation)
    ? (metadata.moderation as unknown[]).slice(-19)
    : [];
  return {
    ...metadata,
    moderation: [...history, { action, userId, at: new Date().toISOString() }],
  };
}

export function errorCodeOf(error: unknown): string {
  if (error instanceof InboxCommentGraphError) return error.code;
  if (error instanceof HttpException) {
    const response = error.getResponse();
    const message =
      typeof response === 'string'
        ? response
        : typeof record(response)?.message === 'string'
          ? (record(response)!.message as string)
          : error.message;
    return /^[a-z0-9_]{1,80}$/.test(message)
      ? message
      : 'comment_effect_failed';
  }
  return 'comment_effect_failed';
}

function encodeCursor(occurredAt: Date, id: string) {
  return Buffer.from(
    JSON.stringify({ o: occurredAt.toISOString(), i: id }),
  ).toString('base64url');
}

function decodeCursor(
  value: string | undefined,
): { occurredAt: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as { o?: unknown; i?: unknown };
    if (
      typeof parsed.o === 'string' &&
      !Number.isNaN(Date.parse(parsed.o)) &&
      typeof parsed.i === 'string' &&
      /^[0-9a-f-]{36}$/i.test(parsed.i)
    ) {
      return { occurredAt: parsed.o, id: parsed.i };
    }
  } catch {
    // fall through
  }
  throw new BadRequestException('comment_cursor_invalid');
}
