import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Visual identity for one operated business — the agency itself, or one
 * managed client (Lyra Social S1.4.9).
 *
 * A domain of its own, deliberately NOT an extension of the company context:
 * that document is textual, capped at 64 KiB and published for LLM
 * consumption with a content hash, so folding logos and palettes into it
 * would turn every logo swap into a republication of the agent's context.
 * See docs/architecture/social/social-settings-architecture.md §3.B and
 * decision D-8.
 *
 * It is also NOT the Business Profile. Name, description, contacts, address
 * and offers stay in `leadflow_client_settings` behind
 * `/platform/business-profile`; nothing here duplicates them. This table
 * holds identity *as it looks*: palette, typography, guidelines.
 *
 * Scope is `tenant_id` + `workspace_id` + nullable `agency_client_id`,
 * identical to `social_ad_account_connections` — `NULL` means the agency
 * itself, never a synthetic "agency" id.
 */

/**
 * Uniqueness is TWO PARTIAL indexes, not one three-column UNIQUE.
 *
 * In Postgres `NULL` is never equal to `NULL` for uniqueness, so a plain
 * `UNIQUE (tenant_id, workspace_id, agency_client_id)` would let N agency
 * rows coexist — a double-click on "create" would silently produce two Brand
 * Kits for the same agency, and nothing in the database would object. The
 * partial pair is the pattern `leadflow_business_mode_templates` already uses
 * (`where: 'tenant_id IS NULL'` / `'IS NOT NULL'`); it is reused here rather
 * than inventing a third convention.
 *
 * The alternative in the repo — a discriminator column with
 * `where: "context_type = 'agency'"` — is deliberately not adopted: it would
 * add a column whose only purpose is the index, duplicating what
 * `agency_client_id IS NULL` already says.
 */
@Index('UQ_brand_kits_agency_scope', ['tenantId', 'workspaceId'], {
  unique: true,
  where: 'agency_client_id IS NULL',
})
@Index(
  'UQ_brand_kits_client_scope',
  ['tenantId', 'workspaceId', 'agencyClientId'],
  { unique: true, where: 'agency_client_id IS NOT NULL' },
)
@Entity('brand_kits')
export class BrandKitEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** `NULL` = the agency's own Brand Kit; otherwise a managed client's. */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  /**
   * `[{ role, hex, label }]`. Structured rather than free text so a future
   * Creative Studio can resolve "the primary colour" without parsing prose.
   * Shape is validated in the DTO layer, not by the database — a CHECK on
   * jsonb structure would have to be dropped and recreated for every new
   * role, and the roles are a product decision that will move.
   */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  palette!: BrandKitPaletteEntry[];

  /** `[{ role, family, source, weights[] }]`. Same reasoning as `palette`. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  typography!: BrandKitTypographyEntry[];

  /** Free-form usage notes ("never stretch the mark", "min clear space"). */
  @Column({ type: 'text', nullable: true })
  guidelines!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export type BrandKitPaletteEntry = {
  role: string;
  hex: string;
  label?: string | null;
};

export type BrandKitTypographyEntry = {
  role: string;
  family: string;
  source?: string | null;
  weights?: number[];
};
