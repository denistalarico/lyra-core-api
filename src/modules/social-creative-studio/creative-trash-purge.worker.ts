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
 * Every use of the media already happened. Failed and cancelled attempts do
 * not hold it; a destination still waiting for its post does.
 */
export const ONLY_PUBLISHED_USE = `
       NOT EXISTS (
         SELECT 1 FROM social_publications p
          WHERE p.media_asset_id = m.id
            AND p.status NOT IN ('published', 'failed', 'cancelled'))
   AND NOT EXISTS (
         SELECT 1 FROM social_publication_media pm
           JOIN social_publications p ON p.id = pm.publication_id
          WHERE pm.media_asset_id = m.id
            AND p.status NOT IN ('published', 'failed', 'cancelled'))
   AND NOT EXISTS (
         SELECT 1 FROM social_destination_creatives d
          WHERE d.media_asset_id = m.id
            AND NOT EXISTS (
                  SELECT 1 FROM social_publications p
                   WHERE p.destination_id = d.destination_id
                     AND p.status = 'published'))
   AND NOT EXISTS (SELECT 1 FROM social_content_references r WHERE r.media_asset_id = m.id)
   AND NOT EXISTS (
         SELECT 1
           FROM social_creative_generation_references gr
           JOIN social_creative_generations pending ON pending.id = gr.generation_id
          WHERE gr.media_asset_id = m.id
            AND pending.status IN ('queued', 'processing'))`;

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
     AND (${NO_OWNER_BEYOND_VERSIONS}
          OR (a.source_type = 'planner_upload' AND ${ONLY_PUBLISHED_USE}))
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
        WHERE deleted_at IS NULL
          AND ((purge_after IS NULL AND trashed_at < $1) OR purge_after < $2)`,
      [cutoff, now],
    );
    let purged = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_TICK; batch += 1) {
      const rows = await this.dataSource.query<{ id: string }[]>(
        PURGEABLE_MEDIA,
        [BATCH_SIZE],
      );
      for (const { id } of rows) {
        try {
          // Only links whose post is out: a dead link would be copied by a
          // duplicate of the content and refused at scheduling.
          await this.dataSource.query(
            'DELETE FROM social_destination_creatives WHERE media_asset_id = $1',
            [id],
          );
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
