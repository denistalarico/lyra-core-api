import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MediaAssetUploadService } from '../../common/media-assets';
import { NO_OWNER_BEYOND_VERSIONS } from './creative-generation-cleanup.worker';

export const CREATIVE_TRASH_RETENTION_DAYS = 30;
const BATCH_SIZE = 100;
const MAX_BATCHES_PER_TICK = 5;
/** The S3 client has no request timeout; a hung delete must not hang the tick. */
const STORAGE_DELETE_TIMEOUT_MS = 30_000;

/**
 * Binaries only deleted assets still point at. A copy shares its source's
 * media, so one live version keeps it, and so does any other owner.
 */
export const PURGEABLE_MEDIA = `
  SELECT DISTINCT m.id
    FROM social_creative_assets a
    JOIN social_creative_asset_versions dv ON dv.creative_asset_id = a.id
    JOIN media_assets m ON m.id IN (dv.media_asset_id, dv.thumbnail_media_asset_id)
   WHERE a.deleted_at IS NOT NULL
     AND m.deleted_at IS NULL
     AND NOT EXISTS (
           SELECT 1
             FROM social_creative_asset_versions lv
             JOIN social_creative_assets la ON la.id = lv.creative_asset_id
            WHERE la.deleted_at IS NULL
              AND (lv.media_asset_id = m.id OR lv.thumbnail_media_asset_id = m.id))
     AND ${NO_OWNER_BEYOND_VERSIONS}
   ORDER BY m.id
   LIMIT $1`;

/**
 * Expires the Lixeira and frees the storage of deleted assets. Both steps are
 * idempotent, so a failed or interrupted tick converges on the next one.
 */
@Injectable()
export class CreativeTrashPurgeWorker {
  private readonly logger = new Logger(CreativeTrashPurgeWorker.name);
  private running = false;

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly mediaUpload: MediaAssetUploadService,
  ) {}

  @Cron('37 * * * *')
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (error) {
      this.logger.error(
        `creative trash purge failed: ${(error as Error)?.name ?? typeof error}`,
      );
    } finally {
      this.running = false;
    }
  }

  async run(now = new Date()) {
    const cutoff = new Date(
      now.getTime() - CREATIVE_TRASH_RETENTION_DAYS * 86_400_000,
    );
    await this.dataSource.query(
      `UPDATE social_creative_assets
          SET deleted_at = now()
        WHERE trashed_at < $1 AND deleted_at IS NULL`,
      [cutoff],
    );
    let purged = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_TICK; batch += 1) {
      const rows = await this.dataSource.query<{ id: string }[]>(
        PURGEABLE_MEDIA,
        [BATCH_SIZE],
      );
      for (const { id } of rows) {
        try {
          await this.purge(id);
          purged += 1;
        } catch (error) {
          // Storage is most likely down; the next tick finds these again.
          this.logger.warn(
            `creative trash purge: storage delete failed media=${id} error=${(error as Error)?.name ?? typeof error}`,
          );
          return { purged };
        }
      }
      if (rows.length < BATCH_SIZE) break;
    }
    if (purged > 0) this.logger.log(`creative trash purge: purged=${purged}`);
    return { purged };
  }

  private purge(id: string) {
    const purge = this.mediaUpload.purgeRetiredObject(id);
    purge.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('storage delete timeout')),
        STORAGE_DELETE_TIMEOUT_MS,
      );
    });
    return Promise.race([purge, timeout]).finally(() => clearTimeout(timer));
  }
}
