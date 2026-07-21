import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import { FilesService } from '../../../../../common/files/files.service';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import { InboxMediaAssetEntity } from '../../../entities/inbox-media-asset.entity';
import { InboxMediaDerivativeEntity } from '../../../entities/inbox-media-derivative.entity';
import { InboxDomainOutboxEntity } from '../../../entities/inbox-domain-outbox.entity';
import { InboxRuntimeConfigService } from '../../../runtime/inbox-runtime-config.service';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/amr',
]);
const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

@Injectable()
export class MetaMediaIngestionWorker {
  private readonly logger = new Logger(MetaMediaIngestionWorker.name);
  private running = false;

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly filesService: FilesService,
    private readonly cryptoService: SettingsCryptoService,
    private readonly config: InboxRuntimeConfigService,
  ) {}

  @Interval(2000)
  async tick() {
    if (!this.config.mediaWorkerEnabled || this.running) return;
    this.running = true;
    try {
      await this.processPending(5);
    } catch (error) {
      this.logger.error(
        'Inbox media worker cycle failed',
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
         WHERE provider = 'meta' AND status IN ('pending','failed')
           AND attempt_count < 3 AND COALESCE(next_attempt_at, now()) <= now()
         ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT $1`,
        [limit],
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
      const token = this.cryptoService.decrypt(channel.accessTokenEncrypted);
      if (!token) throw new Error('missing_channel_token');
      const metadata = await this.fetchMediaMetadata(
        asset.externalMediaId,
        token,
      );
      const mimeType = (metadata.mime_type ?? asset.mimeType)
        ?.split(';')[0]
        .trim();
      if (!mimeType || !ALLOWED_MIME.has(mimeType))
        throw new Error('unsupported_mime');
      const body = await this.fetchMediaBody(metadata.url, token);
      if (body.length > MAX_MEDIA_BYTES) throw new Error('media_too_large');
      this.assertMagicBytes(body, mimeType);
      const digest = createHash('sha256').update(body).digest();
      const checksum = digest.toString('hex');
      if (
        metadata.sha256 &&
        metadata.sha256 !== checksum &&
        metadata.sha256 !== digest.toString('base64')
      )
        throw new Error('checksum_mismatch');
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
        if (asset.kind === 'audio') {
          await manager.getRepository(InboxMediaDerivativeEntity).upsert(
            {
              tenantId: asset.tenantId,
              workspaceId: asset.workspaceId,
              mediaAssetId: asset.id,
              kind: 'transcription',
              status: 'pending',
              content: null,
              language: null,
              confidence: null,
              provider: null,
              model: null,
              processorVersion:
                process.env.INBOX_TRANSCRIPTION_PROCESSOR_VERSION ??
                'transcription-v1',
              errorCode: null,
            },
            [
              'tenantId',
              'workspaceId',
              'mediaAssetId',
              'kind',
              'processorVersion',
            ],
          );
        }
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
      asset.errorCode = this.sanitizeError(error);
      asset.nextAttemptAt =
        asset.attemptCount < 3
          ? new Date(Date.now() + 30_000 * asset.attemptCount)
          : null;
      await repository.save(asset);
    }
  }

  private async fetchMediaMetadata(id: string, token: string) {
    const version = process.env.META_GRAPH_API_VERSION ?? 'v24.0';
    const response = await fetch(
      `https://graph.facebook.com/${version}/${encodeURIComponent(id)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) throw new Error('metadata_download_failed');
    return response.json() as Promise<{
      url: string;
      mime_type?: string;
      sha256?: string;
    }>;
  }
  private async fetchMediaBody(url: string, token: string) {
    const parsed = new URL(url);
    const trustedDomains = ['facebook.com', 'fbcdn.net', 'fbsbx.com'];
    const trustedHost = trustedDomains.some(
      (domain) =>
        parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`),
    );
    if (parsed.protocol !== 'https:' || !trustedHost)
      throw new Error('untrusted_media_url');
    const response = await fetch(parsed, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    const size = Number(response.headers.get('content-length') ?? 0);
    if (!response.ok) throw new Error('media_download_failed');
    if (size > MAX_MEDIA_BYTES) throw new Error('media_too_large');
    return Buffer.from(await response.arrayBuffer());
  }
  private assertMagicBytes(body: Buffer, mime: string) {
    const valid =
      (mime === 'image/jpeg' && body[0] === 0xff && body[1] === 0xd8) ||
      (mime === 'image/png' && body.subarray(1, 4).toString() === 'PNG') ||
      (mime === 'image/webp' && body.subarray(8, 12).toString() === 'WEBP') ||
      (mime === 'audio/ogg' && body.subarray(0, 4).toString() === 'OggS') ||
      (mime === 'audio/mpeg' &&
        (body.subarray(0, 3).toString() === 'ID3' || body[0] === 0xff)) ||
      (mime.startsWith('audio/') && body.length > 8);
    if (!valid) throw new Error('mime_signature_mismatch');
  }
  private sanitizeError(error: unknown) {
    const code =
      error instanceof Error ? error.message : 'media_ingestion_failed';
    return /^[a-z0-9_]{1,80}$/.test(code) ? code : 'media_ingestion_failed';
  }
}
