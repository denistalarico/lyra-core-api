import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreativeAssetService } from './creative-asset.service';
import type { CreativeStudioScope } from './creative-studio.scope';
import { DEFAULT_PLANNER_UPLOAD_RETENTION_DAYS } from './creative-studio-settings.service';
import { ONLY_PUBLISHED_USE } from './creative-trash-purge.worker';

/** Older bindings stay out, so no file already published is deleted by surprise. */
export const PLANNER_UPLOADS_TRACKED_SINCE = '2026-11-08T00:00:00.000Z';
const BATCH_SIZE = 50;

type UntrackedUpload = {
  media_asset_id: string;
  content_item_id: string;
  tenant_id: string;
  workspace_id: string;
  agency_client_id: string | null;
  company_context_id: string | null;
  created_by_id: string | null;
};

const UNTRACKED_UPLOADS = `
  SELECT DISTINCT ON (m.id)
         m.id AS media_asset_id, d.content_item_id, m.tenant_id, m.workspace_id,
         m.agency_client_id, m.company_context_id, m.created_by_id
    FROM social_destination_creatives d
    JOIN media_assets m ON m.id = d.media_asset_id
     AND m.deleted_at IS NULL AND m.source = 'planner_upload'
    JOIN social_content_items i ON i.id = d.content_item_id AND i.deleted_at IS NULL
    JOIN social_plans p ON p.id = i.plan_id AND p.deleted_at IS NULL
     AND p.company_context_id IS NOT DISTINCT FROM m.company_context_id
   WHERE d.created_at >= $1
     AND NOT EXISTS (
           SELECT 1 FROM social_creative_asset_versions v
            WHERE v.media_asset_id = m.id)
   ORDER BY m.id, d.created_at
   LIMIT $2`;

/** A restored file was kept on purpose, so it is never taken again. */
const PUBLISHED_UPLOADS = `
  SELECT a.id,
         COALESCE(s.planner_upload_retention_days, ${DEFAULT_PLANNER_UPLOAD_RETENTION_DAYS}) AS days
    FROM social_creative_assets a
    JOIN social_creative_asset_versions v ON v.id = a.current_version_id
    JOIN media_assets m ON m.id = v.media_asset_id AND m.deleted_at IS NULL
    LEFT JOIN social_creative_studio_settings s
      ON s.tenant_id = a.tenant_id
     AND s.workspace_id = a.workspace_id
     AND s.agency_client_id IS NOT DISTINCT FROM a.agency_client_id
     AND s.company_context_id IS NOT DISTINCT FROM a.company_context_id
   WHERE a.source_type = 'planner_upload'
     AND a.trashed_at IS NULL
     AND a.deleted_at IS NULL
     AND a.restored_at IS NULL
     AND COALESCE(s.planner_upload_retention_days, ${DEFAULT_PLANNER_UPLOAD_RETENTION_DAYS}) > 0
     AND EXISTS (SELECT 1 FROM social_destination_creatives d WHERE d.media_asset_id = m.id)
     AND ${ONLY_PUBLISHED_USE}
   ORDER BY a.id
   LIMIT $1`;

const SEND_TO_TRASH = `
  UPDATE social_creative_assets
     SET status = 'archived',
         archived_at = COALESCE(archived_at, now()),
         trashed_at = now(),
         restore_folder_id = folder_id,
         folder_id = NULL,
         purge_after = now() + make_interval(days => $2::int)
   WHERE id = $1 AND trashed_at IS NULL`;

/**
 * Brings Planner uploads into the Studio and, once every post using them is
 * published, sends them to the Lixeira. Each row stands alone, so one failure
 * never blocks the rest and the next tick retries it.
 */
@Injectable()
export class CreativePlannerRetentionWorker {
  private readonly logger = new Logger(CreativePlannerRetentionWorker.name);
  private running = false;

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly assets: CreativeAssetService,
  ) {}

  @Cron('*/5 * * * *')
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (error) {
      this.logger.error(
        `planner retention failed: ${(error as Error)?.name ?? typeof error}`,
      );
    } finally {
      this.running = false;
    }
  }

  async run() {
    const adopted = await this.adopt();
    const trashed = await this.expire();
    if (adopted || trashed)
      this.logger.log(
        `planner retention: adopted=${adopted} trashed=${trashed}`,
      );
    return { adopted, trashed };
  }

  private async adopt() {
    const rows = await this.dataSource.query<UntrackedUpload[]>(
      UNTRACKED_UPLOADS,
      [PLANNER_UPLOADS_TRACKED_SINCE, BATCH_SIZE],
    );
    let adopted = 0;
    for (const row of rows) {
      const scope: CreativeStudioScope = {
        tenantId: row.tenant_id,
        workspaceId: row.workspace_id,
        agencyClientId: row.agency_client_id,
        companyContextId: row.company_context_id,
      };
      try {
        await this.assets.adoptPlannerUpload(scope, row.created_by_id, {
          mediaAssetId: row.media_asset_id,
          contentItemId: row.content_item_id,
        });
        adopted += 1;
      } catch (error) {
        this.logger.warn(
          `planner retention: adopt failed media=${row.media_asset_id} error=${(error as Error)?.name ?? typeof error}`,
        );
      }
    }
    return adopted;
  }

  private async expire() {
    const rows = await this.dataSource.query<{ id: string; days: number }[]>(
      PUBLISHED_UPLOADS,
      [BATCH_SIZE],
    );
    let trashed = 0;
    for (const row of rows) {
      try {
        await this.dataSource.query(SEND_TO_TRASH, [row.id, row.days]);
        trashed += 1;
      } catch (error) {
        this.logger.warn(
          `planner retention: trash failed asset=${row.id} error=${(error as Error)?.name ?? typeof error}`,
        );
      }
    }
    return trashed;
  }
}
