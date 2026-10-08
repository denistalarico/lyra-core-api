import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { CreativeGenerationConfigService } from './creative-generation-config';
import { CreativeVideoProviderRegistry } from './creative-video-generation.binding';
import { CreativeVideoAvatarEntity } from './entities';

export type CreativeVideoAvatarView = {
  id: string;
  name: string;
  gender: string | null;
  orientation: string | null;
  /** Lyra proxy path; the provider's URL never reaches the client. */
  previewPath: string | null;
};

/**
 * CS4-B — Lyra's projection of the avatars UGC may use.
 *
 * The provider's listing is mirrored into `social_creative_video_avatars`
 * (ids, names, engine support, default voice, preview URL). The client only
 * ever sees Lyra ids and a Lyra preview path; a generation stores the Lyra
 * id, and the provider ids are resolved from this table by the worker.
 * Nothing is copied to storage: previews are streamed through on demand.
 *
 * Sync: daily, in the worker process, and once lazily when the list is empty
 * (first use after enabling). An avatar that disappears from the provider
 * becomes `available = false` (kept: past generations reference it).
 */
@Injectable()
export class CreativeVideoAvatarCatalogService {
  private readonly logger = new Logger(CreativeVideoAvatarCatalogService.name);
  private lazySyncTried = false;

  constructor(
    private readonly providers: CreativeVideoProviderRegistry,
    @InjectRepository(CreativeVideoAvatarEntity, 'agency')
    private readonly avatars: Repository<CreativeVideoAvatarEntity>,
    private readonly generationConfig: CreativeGenerationConfigService,
  ) {}

  @Cron('41 5 * * *')
  async scheduledSync(): Promise<void> {
    if (!this.generationConfig.workerEnabled) return;
    await this.sync().catch((error: unknown) =>
      this.logger.warn(
        `video avatar sync failed: ${(error as Error)?.name ?? typeof error}`,
      ),
    );
  }

  async sync(): Promise<{ listed: number; available: number }> {
    const provider = this.providers.forMode('ugc_avatar');
    if (!provider.enabled || !provider.listAvatars)
      return { listed: 0, available: 0 };
    const started = new Date();
    const entries = await provider.listAvatars();
    let available = 0;
    for (const entry of entries) {
      const usable = provider.isAvatarUsable(entry);
      if (usable) available += 1;
      await this.avatars.upsert(
        {
          provider: provider.id,
          providerAvatarId: entry.providerAvatarId,
          name: entry.name,
          avatarType: entry.avatarType,
          gender: entry.gender,
          orientation: entry.orientation,
          supportedEngines: [...entry.supportedEngines],
          providerVoiceId: entry.defaultVoiceId,
          previewImageUrl: entry.previewImageUrl,
          available: usable,
          syncedAt: new Date(),
        },
        ['provider', 'providerAvatarId'],
      );
    }
    // Only after a complete listing: a partial failure above threw first.
    await this.avatars.update(
      { provider: provider.id, syncedAt: LessThan(started) },
      { available: false },
    );
    this.logger.log(
      `video avatar sync provider=${provider.id} listed=${entries.length} available=${available}`,
    );
    return { listed: entries.length, available };
  }

  async list(): Promise<CreativeVideoAvatarView[]> {
    const provider = this.providers.forMode('ugc_avatar');
    if (!provider.enabled) return [];
    let rows = await this.available(provider.id);
    if (!rows.length && !this.lazySyncTried) {
      this.lazySyncTried = true;
      await this.sync().catch(() => undefined);
      rows = await this.available(provider.id);
    }
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      gender: row.gender,
      orientation: row.orientation,
      previewPath: row.previewImageUrl
        ? `/social/creative-studio/video-avatars/${row.id}/preview`
        : null,
    }));
  }

  async preview(id: string): Promise<{ body: Buffer; mimeType: string }> {
    const row = await this.avatars.findOneBy({ id, available: true });
    const provider = row ? this.providers.byId(row.provider) : null;
    const preview =
      row?.previewImageUrl && provider?.fetchAvatarPreview
        ? await provider.fetchAvatarPreview(row.previewImageUrl)
        : null;
    if (!preview) throw new NotFoundException('Prévia não encontrada.');
    return preview;
  }

  private available(providerId: string) {
    return this.avatars.find({
      where: { provider: providerId, available: true },
      order: { name: 'ASC' },
    });
  }
}
