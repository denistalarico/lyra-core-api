import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Append-only evidence of what destination an ad set was *seen* to have.
 *
 * The name is the contract. Every column here says "observed", never
 * "effective" or "changed", because Meta does not tell us when a destination
 * changed. The Marketing API was probed for exactly that: `last_modified_time`,
 * `effective_time` and `destination_type_updated_time` are all silently dropped
 * from the ad set payload, and the one timestamp that does come back —
 * `updated_time` — moves for *any* edit. In the production account it spreads
 * across 39 distinct days while destinations barely vary, so reading it as a
 * destination-change stamp would attach a precise date to a fact nobody
 * measured.
 *
 * So this table records the only thing that is actually true: at instant T, a
 * sync asked the provider and the provider answered X. What happened between
 * two observations is unknown, and the reader is expected to say so.
 *
 * `social_ad_entities` keeps the *current* destination and is not replaced by
 * this: one answers "where does this ad set send people now", which every
 * screen needs, and the other answers "what did we see, and when", which only
 * a temporal question needs. Deriving the first from the second would mean an
 * ORDER BY on every render.
 *
 * Meta-shaped for now, and honestly so: `destination_raw` holds a Meta enum and
 * the mapping that produced `destination_type` is Meta's. What is *not*
 * Meta-specific is the shape — provider, entity, canonical value, raw value,
 * observation instant — so a Google Ads adapter writing its own rows here would
 * need a mapping function, not a second table. That is the abstraction this
 * slice is willing to pay for; a provider-generic observation framework is not.
 */
@Entity('social_ad_destination_observations')
/**
 * The read path: one ad set's observations, newest first.
 *
 * Also the index the temporal query uses to find "the last observation at or
 * before date D", which is the whole point of the table.
 */
@Index('IDX_social_ad_destination_obs_entity', ['adEntityId', 'observedAt'])
/**
 * Idempotency, and the reason it is shaped this way.
 *
 * A retried sync run must not append a second identical row, so the run is part
 * of the key. What the key deliberately does *not* contain is only the entity
 * and the destination: `UNIQUE(ad_entity_id, destination_type)` would look
 * tempting and would be wrong, because it makes
 * `whatsapp → instagram_direct → whatsapp` impossible to record — the third
 * observation is a real event and collides with the first.
 *
 * Partial, because `sync_run_id` is nullable: a manual sweep outside the queue
 * has no run to key on, and NULLs would silently disable the constraint for
 * exactly those rows. Those are covered by the recorder's change check instead.
 */
@Index(
  'UQ_social_ad_destination_obs_run',
  ['adEntityId', 'syncRunId', 'destinationType'],
  { unique: true, where: `"sync_run_id" IS NOT NULL` },
)
export class SocialAdDestinationObservationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** Managed client this observation belongs to. NULL is the agency's own account. */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  /**
   * The ad set this is about, by internal id rather than by provider id.
   *
   * `social_ad_entities.id` is stable across a provider that reuses ids and
   * across the same external id appearing under two connections, which the
   * external id alone is not. Cascades on delete: an observation about a row
   * that no longer exists cannot be joined to anything.
   */
  @Column({ name: 'ad_entity_id', type: 'uuid' })
  adEntityId!: string;

  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  /** Canonical destination, from the same resolver the read model uses. */
  @Column({ name: 'destination_type', type: 'varchar', length: 40 })
  destinationType!: string;

  /**
   * The provider's own string. NULL only when the provider explicitly answered
   * with no usable value while still being asked — never when the field was
   * simply absent, because that case does not produce an observation at all.
   */
  @Column({
    name: 'destination_raw',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  destinationRaw!: string | null;

  /**
   * When Lyra saw this — not when the provider changed it.
   *
   * The distinction is the entire reason this table exists rather than a
   * `destination_changed_at` column. An observation on 15/09 following one on
   * 28/08 proves the destination differed at some point in that window; it does
   * not locate the change inside it. Any reader that presents this as the
   * moment of change is overstating the evidence.
   */
  @Column({ name: 'observed_at', type: 'timestamptz' })
  observedAt!: Date;

  /**
   * The sync run that made the observation, when there was one.
   *
   * Nullable and `ON DELETE SET NULL`, because S2.9 deletes old runs as
   * operational history: losing the record of *which* sweep saw something must
   * never delete the evidence that it was seen. Provenance is a bonus here, not
   * the thing being stored.
   */
  @Column({ name: 'sync_run_id', type: 'uuid', nullable: true })
  syncRunId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
