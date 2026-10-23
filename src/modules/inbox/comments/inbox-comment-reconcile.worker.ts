import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull } from 'typeorm';
import { InboxChannelEntity } from '../entities/inbox-channel.entity';
import {
  InboxCommentGraphClient,
  InboxCommentGraphError,
} from './inbox-comment-graph.client';
import { errorCodeOf, InboxCommentService } from './inbox-comment.service';

const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const CONTENTS_PER_CHANNEL = 10;
const COMMENTS_PER_CONTENT = 100;
/** Graph calls one run may spend across every channel (RK-IX-4). */
const MAX_CALLS_PER_RUN = 80;

/**
 * IX3 item 6 — fills the gaps the webhook leaves: the initial load of a
 * channel and anything missed while the app was unsubscribed.
 *
 * `INBOX_COMMENTS_RECONCILE_ENABLED` is fail-closed (only `'true'` runs it).
 * A channel without a previous run is loaded within a minute (that is the
 * "once on connect"); every channel is revisited every 15 minutes. A
 * permission error marks the channel (`metadata.commentsSync`) instead of
 * stopping the run, and backfilled comments never wake the agent — it only
 * answers comments that arrive live.
 */
@Injectable()
export class InboxCommentReconcileWorker {
  private readonly logger = new Logger(InboxCommentReconcileWorker.name);
  private running = false;

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly comments: InboxCommentService,
    private readonly graph: InboxCommentGraphClient,
  ) {}

  private get enabled() {
    return process.env.INBOX_COMMENTS_RECONCILE_ENABLED === 'true';
  }

  @Interval(60_000)
  async initialLoadTick() {
    if (!this.enabled) return;
    await this.exclusive(async () => {
      const channels = await this.channels();
      const fresh = channels.filter(
        (channel) => !channel.metadata?.commentsSync,
      );
      await this.reconcile(fresh.slice(0, 2));
    });
  }

  @Interval(15 * 60_000)
  async tick() {
    if (!this.enabled) return;
    await this.exclusive(async () => {
      await this.reconcile(await this.channels());
      const linked = await this.comments.linkPendingPrivateReplies();
      if (linked)
        this.logger.log({ event: 'comment_conversations_linked', linked });
    });
  }

  /** Runs one pass; returns the calls spent (for the specs). */
  async reconcile(channels: InboxChannelEntity[]): Promise<number> {
    const budget = { calls: MAX_CALLS_PER_RUN };
    for (const channel of channels) {
      if (budget.calls <= 0) break;
      await this.reconcileChannel(channel, budget);
    }
    return MAX_CALLS_PER_RUN - budget.calls;
  }

  private async reconcileChannel(
    channel: InboxChannelEntity,
    budget: { calls: number },
  ) {
    const startedAt = new Date();
    let contents = 0;
    let comments = 0;
    try {
      const access = this.comments.access(channel);
      budget.calls -= 1;
      const contentIds = await this.graph.listRecentContentIds(
        access,
        new Date(Date.now() - LOOKBACK_MS),
        CONTENTS_PER_CHANNEL,
      );
      for (const contentId of contentIds) {
        if (budget.calls <= 0) break;
        budget.calls -= 1;
        const found = await this.graph.listComments(
          access,
          contentId,
          COMMENTS_PER_CONTENT,
        );
        contents += 1;
        for (const comment of found) {
          await this.comments.ingest(channel, comment);
          comments += 1;
        }
        if (found.length && budget.calls > 0) {
          budget.calls -= 1;
          await this.comments.resolveContent(channel, contentId);
        }
      }
      await this.markChannel(channel, {
        status: 'ok',
        checkedAt: startedAt.toISOString(),
        contents,
        comments,
      });
    } catch (error) {
      const errorCode = errorCodeOf(error);
      await this.markChannel(channel, {
        status:
          error instanceof InboxCommentGraphError &&
          error.code === 'meta_comment_permission_denied'
            ? 'permission_denied'
            : 'failed',
        errorCode,
        checkedAt: startedAt.toISOString(),
        contents,
        comments,
      });
      this.logger.warn({
        event: 'comment_reconcile_channel_failed',
        channelId: channel.id,
        errorCode,
      });
    }
  }

  private channels() {
    return this.dataSource.getRepository(InboxChannelEntity).find({
      where: {
        type: In(['instagram', 'facebook_messenger']),
        provider: 'meta',
        status: 'active',
        connectionStatus: 'connected',
        deletedAt: IsNull(),
      },
      order: { createdAt: 'ASC' },
      take: 200,
    });
  }

  private async markChannel(
    channel: InboxChannelEntity,
    state: Record<string, unknown>,
  ) {
    await this.dataSource.query(
      `UPDATE inbox_channels
          SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('commentsSync', $3::jsonb)
        WHERE id = $1 AND tenant_id = $2`,
      [channel.id, channel.tenantId, JSON.stringify(state)],
    );
  }

  private async exclusive(run: () => Promise<void>) {
    if (this.running) return;
    this.running = true;
    try {
      await run();
    } catch (error) {
      this.logger.warn(`Comment reconcile failed: ${errorCodeOf(error)}`);
    } finally {
      this.running = false;
    }
  }
}
