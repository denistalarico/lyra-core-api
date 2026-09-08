import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { SocialOrganicInteractionEntity } from './entities/social-organic-interaction.entity';
import type { NormalizedOrganicInteraction } from './meta/meta-organic-webhook.handlers';

export type SocialOrganicInteractionScope = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  assetId: string;
};

export type RecordInteractionInput = {
  provider: string;
  scope: SocialOrganicInteractionScope;
  interaction: NormalizedOrganicInteraction;
  sourceWebhookEventId: string | null;
};

export type RecordInteractionResult = {
  interactionId: string;
  created: boolean;
};

/**
 * Persists normalized interactions, idempotently.
 *
 * **The idempotency contract (§11).** The key is
 * `(provider, asset_id, external_interaction_id)` — the provider's own id for
 * the thing, scoped to the asset it happened on. Deliberately *not* including
 * the interaction type: a comment that is created and later edited is one
 * comment, and a `comment_updated` arriving after `comment_created` must
 * converge onto that row rather than create a second one. That is what "delete/
 * update must converge" means in practice.
 *
 * The database enforces it. `ON CONFLICT DO UPDATE` in one statement means two
 * workers racing on the same redelivery cannot both insert — a read-then-write
 * would leave exactly that window open.
 */
@Injectable()
export class SocialOrganicInteractionService {
  constructor(
    @InjectRepository(SocialOrganicInteractionEntity, 'agency')
    private readonly interactions: Repository<SocialOrganicInteractionEntity>,
  ) {}

  async record(
    input: RecordInteractionInput,
  ): Promise<RecordInteractionResult> {
    const { interaction, scope } = input;

    const result = await this.interactions
      .createQueryBuilder()
      .insert()
      .into(SocialOrganicInteractionEntity)
      .values({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        assetId: scope.assetId,
        provider: input.provider,
        surface: interaction.surface,
        interactionType: interaction.interactionType,
        externalInteractionId: interaction.externalInteractionId,
        externalParentId: interaction.externalParentId,
        externalContentId: interaction.externalContentId,
        actorExternalId: interaction.actorExternalId,
        actorDisplayName: interaction.actorDisplayName,
        text: interaction.text,
        occurredAt: interaction.occurredAt,
        providerCreatedAt: interaction.providerCreatedAt,
        status: interaction.status,
        metadata: interaction.metadata,
        sourceWebhookEventId: input.sourceWebhookEventId,
        // The builder types a jsonb column as a *deep* partial, which cannot
        // express "an arbitrary JSON object"; the same cast is used by
        // `social-ad-metrics-writer.service.ts` for the same reason.
      } as QueryDeepPartialEntity<SocialOrganicInteractionEntity>)
      .orUpdate(
        [
          'interaction_type',
          'status',
          'external_parent_id',
          'external_content_id',
          'actor_external_id',
          'actor_display_name',
          'text',
          'occurred_at',
          'provider_created_at',
          'metadata',
          'updated_at',
        ],
        ['provider', 'asset_id', 'external_interaction_id'],
      )
      // `xmax = 0` is true only for a row this statement inserted; on a
      // conflict-update Postgres leaves the old tuple's xmax set. It is the
      // only way to tell insert from update in a single round trip.
      .returning('id, (xmax = 0) AS inserted')
      .execute();

    const [row] = (result.raw ?? []) as {
      id: string;
      inserted: boolean;
    }[];

    return {
      interactionId: row?.id ?? '',
      created: Boolean(row?.inserted),
    };
  }
}
