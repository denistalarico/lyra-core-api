import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SocialCampaignRecommendationRunStatus =
  | 'processing'
  | 'succeeded'
  | 'failed';

export type SocialCampaignRecommendationConfidence = 'low' | 'medium' | 'high';

export type SocialCampaignRecommendationItem = {
  priority: 'low' | 'medium' | 'high';
  title: string;
  rationale: string;
  evidenceKeys: string[];
  suggestedAction: string;
  expectedImpact: string;
  confidence: SocialCampaignRecommendationConfidence;
  observationWindowDays: number;
  caveats: string[];
};

/**
 * One immutable, advisory-only LLM reading of a paid-media evidence snapshot.
 *
 * There is deliberately no accepted/applied/rejected state, proposed config,
 * provider operation id or execution metadata. C4 explains and suggests; a
 * later assisted-action domain must create its own governed record after a
 * separate human confirmation.
 */
@Entity('social_campaign_recommendations')
@Index('UQ_social_campaign_recommendations_request', ['requestId'], {
  unique: true,
})
@Index('IDX_social_campaign_recommendations_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'connectionId',
  'createdAt',
])
@Check(
  'CK_social_campaign_recommendation_status',
  `"status" IN ('processing', 'succeeded', 'failed')`,
)
@Check(
  'CK_social_campaign_recommendation_period',
  `"period_since" <= "period_until"`,
)
@Check(
  'CK_social_campaign_recommendation_cost',
  `("cost_cents" IS NULL OR "cost_cents" >= 0)
   AND ("input_tokens" IS NULL OR "input_tokens" >= 0)
   AND ("cached_input_tokens" IS NULL OR "cached_input_tokens" >= 0)
   AND ("output_tokens" IS NULL OR "output_tokens" >= 0)
   AND ("latency_ms" IS NULL OR "latency_ms" >= 0)
   AND "attempts" >= 0`,
)
export class SocialCampaignRecommendationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  /** Caller-generated retry identity, meaningful only inside the trusted scope. */
  @Column({ name: 'request_id', type: 'uuid' })
  requestId!: string;

  @Column({ type: 'varchar', length: 20, default: 'processing' })
  status!: SocialCampaignRecommendationRunStatus;

  @Column({ name: 'period_since', type: 'date' })
  periodSince!: string;

  @Column({ name: 'period_until', type: 'date' })
  periodUntil!: string;

  @Column({ name: 'evidence_hash', type: 'varchar', length: 64 })
  evidenceHash!: string;

  /** Sanitised local facts only; never a provider payload, token or raw account id. */
  @Column({ name: 'evidence_snapshot', type: 'jsonb' })
  evidenceSnapshot!: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  recommendations!: SocialCampaignRecommendationItem[];

  @Column({ type: 'varchar', length: 80, nullable: true })
  provider!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  model!: string | null;

  @Column({ name: 'prompt_version', type: 'varchar', length: 40 })
  promptVersion!: string;

  @Column({ name: 'input_tokens', type: 'integer', nullable: true })
  inputTokens!: number | null;

  @Column({ name: 'cached_input_tokens', type: 'integer', nullable: true })
  cachedInputTokens!: number | null;

  @Column({ name: 'output_tokens', type: 'integer', nullable: true })
  outputTokens!: number | null;

  @Column({ name: 'cost_cents', type: 'integer', nullable: true })
  costCents!: number | null;

  @Column({ name: 'cost_is_estimated', type: 'boolean', default: true })
  costIsEstimated!: boolean;

  @Column({ name: 'latency_ms', type: 'integer', nullable: true })
  latencyMs!: number | null;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  /** Safe internal vocabulary only; provider response bodies are never stored. */
  @Column({
    name: 'failure_code',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  failureCode!: string | null;

  @Column({ name: 'requested_by_id', type: 'uuid', nullable: true })
  requestedById!: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
