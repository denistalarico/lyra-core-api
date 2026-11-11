import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One observation of a public trending search (Google Trends "Trending now").
 *
 * The feed only answers "what is spiking right now", so the Overview's week
 * and month rankings are aggregated from these hourly observations. The rows
 * are public data shared by every tenant — not tenant-scoped on purpose, so
 * the feed is read once per hour rather than once per agency. Kept 35 days.
 */
@Entity('social_trend_snapshots')
@Index('IDX_social_trend_snapshots_window', ['country', 'observedAt'])
export class SocialTrendSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 2 })
  country!: string;

  @Column({ type: 'varchar', length: 200 })
  term!: string;

  @Column({ name: 'normalized_term', type: 'varchar', length: 200 })
  normalizedTerm!: string;

  /** Google's bucketed estimate ("500+") as a number; null when unreadable. */
  @Column({ type: 'integer', nullable: true })
  traffic!: number | null;

  @Column({ name: 'traffic_label', type: 'varchar', length: 40, nullable: true })
  trafficLabel!: string | null;

  /** A news article explaining the spike, when the feed carried one. */
  @Column({ name: 'news_url', type: 'text', nullable: true })
  newsUrl!: string | null;

  @Column({ name: 'news_title', type: 'varchar', length: 400, nullable: true })
  newsTitle!: string | null;

  @Column({ name: 'observed_at', type: 'timestamptz', default: () => 'now()' })
  observedAt!: Date;
}
