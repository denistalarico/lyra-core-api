import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { Readable } from 'stream';
import { DataSource } from 'typeorm';
import { FilesService } from '../../../common/files/files.service';
import { InboxMediaAssetEntity } from '../entities/inbox-media-asset.entity';
import { InboxMediaDerivativeEntity } from '../entities/inbox-media-derivative.entity';
import { InboxDomainOutboxEntity } from '../entities/inbox-domain-outbox.entity';
import { InboxProviderService } from './inbox-provider.service';
import { InboxRuntimeConfigService } from './inbox-runtime-config.service';
import { InboxProviderError } from './inbox-runtime.contracts';

@Injectable()
export class AudioTranscriptionWorker {
  private readonly logger = new Logger(AudioTranscriptionWorker.name);
  private running = false;
  private readonly workerId = `${hostname()}:${process.pid}:transcription`;

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly files: FilesService,
    private readonly provider: InboxProviderService,
    private readonly config: InboxRuntimeConfigService,
  ) {}

  @Interval(2_000)
  async tick(): Promise<void> {
    if (
      !this.config.workersEnabled ||
      this.config.transcriptionMode === 'disabled' ||
      this.running
    )
      return;
    this.running = true;
    try {
      await this.processPending(2);
    } catch (error) {
      this.logger.error(`Transcription cycle failed: ${errorCode(error)}`);
    } finally {
      this.running = false;
    }
  }

  async processPending(limit = 2): Promise<number> {
    const ids = await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<{ id: string }>>(
        `SELECT derivative.id
         FROM inbox_media_derivatives derivative
         JOIN inbox_media_assets asset
           ON asset.id = derivative.media_asset_id
          AND asset.tenant_id = derivative.tenant_id
          AND asset.workspace_id = derivative.workspace_id
         WHERE derivative.kind = 'transcription'
           AND asset.kind = 'audio' AND asset.status = 'available'
           AND derivative.attempt_count < 3
           AND (
             (derivative.status IN ('pending','failed') AND COALESCE(derivative.next_attempt_at, now()) <= now())
             OR (derivative.status = 'processing' AND derivative.locked_at < now() - interval '2 minutes')
           )
         ORDER BY derivative.created_at, derivative.id
         FOR UPDATE OF derivative SKIP LOCKED LIMIT $1`,
        [limit],
      );
      if (rows.length)
        await manager
          .createQueryBuilder()
          .update(InboxMediaDerivativeEntity)
          .set({
            status: 'processing',
            lockedAt: new Date(),
            lockedBy: this.workerId,
            attemptCount: () => 'attempt_count + 1',
            errorCode: null,
          })
          .whereInIds(rows.map((row) => row.id))
          .execute();
      return rows.map((row) => row.id);
    });
    for (const id of ids) await this.processOne(id);
    return ids.length;
  }

  private async processOne(id: string): Promise<void> {
    const derivatives = this.dataSource.getRepository(
      InboxMediaDerivativeEntity,
    );
    const derivative = await derivatives.findOneBy({
      id,
      status: 'processing',
      lockedBy: this.workerId,
    });
    if (!derivative) return;
    const asset = await this.dataSource
      .getRepository(InboxMediaAssetEntity)
      .findOneBy({
        id: derivative.mediaAssetId,
        tenantId: derivative.tenantId,
        workspaceId: derivative.workspaceId,
        status: 'available',
      });
    try {
      if (!asset?.objectKey || !asset.mimeType || !asset.checksum)
        throw new InboxProviderError('audio_asset_unavailable', false);
      const byteSize = Number(asset.byteSize ?? 0);
      if (
        !Number.isFinite(byteSize) ||
        byteSize <= 0 ||
        byteSize > this.config.maxAudioBytes
      )
        throw new InboxProviderError('audio_size_not_allowed', false);
      const file = await this.files.getPrivateAsset(asset.objectKey);
      const bytes = await streamBuffer(file.body, this.config.maxAudioBytes);
      const correlationId = randomUUID();
      const result = await this.provider.transcribe({
        tenantId: asset.tenantId,
        workspaceId: asset.workspaceId,
        assetId: asset.id,
        mimeType: asset.mimeType,
        byteSize: bytes.length,
        checksum: asset.checksum,
        bytes,
        expectedLanguage:
          typeof asset.metadata.language === 'string'
            ? asset.metadata.language
            : undefined,
        correlationId,
        idempotencyKey: `transcription:${asset.workspaceId}:${asset.checksum}:${derivative.processorVersion}`,
      });
      derivative.status = 'available';
      derivative.content = result.text;
      derivative.language = result.language;
      derivative.confidence =
        result.confidence === null ? null : String(result.confidence);
      derivative.provider = result.provider;
      derivative.model = result.model;
      derivative.assetChecksum = asset.checksum;
      derivative.outcome = result.outcome;
      derivative.usage = result.usage;
      derivative.latencyMs = result.latencyMs;
      derivative.availableAt = result.completedAt;
      derivative.completedAt = result.completedAt;
      derivative.lockedAt = null;
      derivative.lockedBy = null;
      derivative.nextAttemptAt = null;
      derivative.errorCode = null;
      derivative.metadata = { correlationId };
      await this.dataSource.transaction(async (manager) => {
        await manager
          .getRepository(InboxMediaDerivativeEntity)
          .save(derivative);
        await manager.getRepository(InboxDomainOutboxEntity).save({
          tenantId: asset.tenantId,
          workspaceId: asset.workspaceId,
          aggregateType: 'inbox_media_derivative',
          aggregateId: derivative.id,
          eventName: 'leadflow.inbox.media_derivative.updated',
          eventVersion: 1,
          idempotencyKey: `derivative:${derivative.id}:available:${derivative.attemptCount}`,
          payload: {
            conversationId: asset.conversationId,
            mediaId: asset.id,
            derivativeId: derivative.id,
            status: derivative.status,
          },
          publishedAt: null,
        });
      });
    } catch (error) {
      const retryable =
        error instanceof InboxProviderError ? error.retryable : true;
      derivative.status = 'failed';
      derivative.errorCode = errorCode(error);
      derivative.lockedAt = null;
      derivative.lockedBy = null;
      derivative.completedAt = new Date();
      derivative.nextAttemptAt =
        retryable && derivative.attemptCount < 3
          ? new Date(Date.now() + 15_000 * 2 ** (derivative.attemptCount - 1))
          : null;
      await derivatives.save(derivative);
    }
  }
}

async function streamBuffer(
  stream: Readable,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const part = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as Uint8Array);
    total += part.length;
    if (total > maxBytes)
      throw new InboxProviderError('audio_size_not_allowed', false);
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}
function errorCode(error: unknown): string {
  const value =
    error instanceof InboxProviderError
      ? error.code
      : error instanceof Error
        ? error.message
        : 'transcription_failed';
  return /^[a-z0-9_]{1,80}$/.test(value) ? value : 'transcription_failed';
}
