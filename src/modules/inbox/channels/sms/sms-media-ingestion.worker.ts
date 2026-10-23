import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { SettingsCryptoService } from '../../../../common/crypto/settings-crypto.service';
import { FilesService } from '../../../../common/files/files.service';
import { InboxChannelEntity } from '../../entities/inbox-channel.entity';
import { InboxDomainOutboxEntity } from '../../entities/inbox-domain-outbox.entity';
import { InboxMediaAssetEntity } from '../../entities/inbox-media-asset.entity';
import { InboxRuntimeConfigService } from '../../runtime/inbox-runtime-config.service';
import { SMS_PROVIDERS } from './sms-provider.adapter';
import { SmsProviderRegistry } from './sms-provider.registry';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/3gpp',
  'audio/mpeg',
  'audio/mp4',
  'audio/amr',
  'audio/ogg',
]);
/** MMS carriers cap far below this; it bounds a misbehaving URL. */
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

/**
 * Inbound MMS files (§6 IX4 item 6), on the model of the Meta worker: the
 * provider URL needs the tenant's key and expires in 30 days, so the file is
 * copied to private storage and served by `/inbox/media/:mediaId/content`.
 */
@Injectable()
export class SmsMediaIngestionWorker {
  private readonly logger = new Logger(SmsMediaIngestionWorker.name);
  private running = false;

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly filesService: FilesService,
    private readonly cryptoService: SettingsCryptoService,
    private readonly config: InboxRuntimeConfigService,
    private readonly providers: SmsProviderRegistry,
  ) {}

  @Interval(3000)
  async tick() {
    if (!this.config.mediaWorkerEnabled || this.running) return;
    this.running = true;
    try {
      await this.processPending(5);
    } catch (error) {
      this.logger.error(
        'SMS media worker cycle failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }

  async processPending(limit = 5) {
    const ids = await this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        `SELECT id FROM inbox_media_assets
         WHERE provider = ANY($2::text[]) AND status IN ('pending','failed')
           AND attempt_count < 3 AND COALESCE(next_attempt_at, now()) <= now()
         ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT $1`,
        [limit, [...SMS_PROVIDERS]],
      )) as unknown as Array<{ id: string }>;
      if (rows.length) {
        await manager
          .createQueryBuilder()
          .update(InboxMediaAssetEntity)
          .set({
            status: 'processing',
            attemptCount: () => 'attempt_count + 1',
          })
          .whereInIds(rows.map((row) => row.id))
          .execute();
      }
      return rows.map((row) => row.id);
    });
    for (const id of ids) await this.processOne(id);
    return ids.length;
  }

  private async processOne(id: string) {
    const repository = this.dataSource.getRepository(InboxMediaAssetEntity);
    const asset = await repository.findOneBy({ id });
    if (!asset) return;
    try {
      const channel = await this.dataSource
        .getRepository(InboxChannelEntity)
        .findOneByOrFail({
          id: asset.channelId,
          tenantId: asset.tenantId,
          workspaceId: asset.workspaceId,
        });
      const apiKey = this.cryptoService.decrypt(channel.accessTokenEncrypted);
      if (!apiKey) throw new Error('missing_channel_token');
      const url =
        typeof asset.metadata?.directUrl === 'string'
          ? asset.metadata.directUrl
          : null;
      if (!url) throw new Error('missing_media_url');
      const downloaded = await this.providers
        .get(asset.provider)
        .downloadMedia(url, apiKey, MAX_MEDIA_BYTES);
      const mimeType = (asset.mimeType ?? downloaded.contentType ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (!ALLOWED_MIME.has(mimeType)) throw new Error('unsupported_mime');
      const body = downloaded.body;
      assertMagicBytes(body, mimeType);
      const checksum = createHash('sha256').update(body).digest('hex');
      const objectKey = `tenants/${asset.tenantId}/workspaces/${asset.workspaceId}/inbox/${asset.conversationId}/${randomUUID()}`;
      await this.filesService.uploadPrivateBuffer({
        body,
        path: objectKey,
        contentType: mimeType,
      });
      asset.objectKey = objectKey;
      asset.mimeType = mimeType;
      asset.byteSize = String(body.length);
      asset.checksum = checksum;
      asset.status = 'available';
      asset.availableAt = new Date();
      asset.nextAttemptAt = null;
      asset.errorCode = null;
      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(InboxMediaAssetEntity).save(asset);
        await manager.getRepository(InboxDomainOutboxEntity).save({
          tenantId: asset.tenantId,
          workspaceId: asset.workspaceId,
          aggregateType: 'inbox_media_asset',
          aggregateId: asset.id,
          eventName: 'leadflow.inbox.media.updated',
          eventVersion: 1,
          idempotencyKey: `media:${asset.id}:available:${asset.checksum}`,
          payload: {
            conversationId: asset.conversationId,
            messageId: asset.messageId,
            mediaId: asset.id,
            status: asset.status,
          },
          publishedAt: null,
        });
      });
    } catch (error) {
      asset.status = 'failed';
      asset.errorCode = sanitizeError(error);
      asset.nextAttemptAt =
        asset.attemptCount < 3
          ? new Date(Date.now() + 30_000 * asset.attemptCount)
          : null;
      await repository.save(asset);
    }
  }
}

function assertMagicBytes(body: Buffer, mime: string) {
  const valid =
    (mime === 'image/jpeg' && body[0] === 0xff && body[1] === 0xd8) ||
    (mime === 'image/png' && body.subarray(1, 4).toString() === 'PNG') ||
    (mime === 'image/webp' && body.subarray(8, 12).toString() === 'WEBP') ||
    (mime === 'image/gif' && body.subarray(0, 3).toString() === 'GIF') ||
    ((mime === 'video/mp4' || mime === 'video/3gpp' || mime === 'audio/mp4') &&
      body.subarray(4, 8).toString() === 'ftyp') ||
    (mime === 'audio/ogg' && body.subarray(0, 4).toString() === 'OggS') ||
    (mime === 'audio/amr' && body.subarray(0, 5).toString() === '#!AMR') ||
    (mime === 'audio/mpeg' &&
      (body.subarray(0, 3).toString() === 'ID3' || body[0] === 0xff));
  if (!valid) throw new Error('mime_signature_mismatch');
}

function sanitizeError(error: unknown) {
  const code =
    error instanceof Error ? error.message : 'media_ingestion_failed';
  return /^[a-z0-9_]{1,80}$/.test(code) ? code : 'media_ingestion_failed';
}
