import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * Official Help Center article. GLOBAL / platform-owned: no tenantId /
 * workspaceId. Content is authored by the platform and versioned in code
 * (see ../content). Read-only for tenant users — there are no write endpoints.
 *
 * The link to its category is by `categoryKey` (stable, global), not by id,
 * so content stays portable and seed ordering never breaks the relation.
 */
@Entity("help_articles")
@Index(["systemKey", "locale"], { unique: true })
@Index(["slug", "locale"], { unique: true })
@Index(["locale", "categoryKey", "status"])
export class HelpArticle {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "system_key", type: "varchar", length: 160 })
  systemKey!: string;

  @Column({ type: "varchar", length: 200 })
  slug!: string;

  @Column({ type: "varchar", length: 220 })
  title!: string;

  @Column({ type: "text", nullable: true })
  summary!: string | null;

  @Column({ type: "text", default: "" })
  content!: string;

  @Column({ name: "content_format", type: "varchar", length: 16, default: "html" })
  contentFormat!: string;

  @Column({ name: "category_key", type: "varchar", length: 120, nullable: true })
  categoryKey!: string | null;

  @Column({ name: "product_key", type: "varchar", length: 80, default: "lyra-agency" })
  productKey!: string;

  @Column({ name: "module_key", type: "varchar", length: 80, nullable: true })
  moduleKey!: string | null;

  @Column({ type: "varchar", length: 8, default: "pt-BR" })
  locale!: string;

  @Column({ type: "int", default: 1 })
  version!: number;

  @Column({ name: "sort_order", type: "int", default: 0 })
  sortOrder!: number;

  @Column({ type: "varchar", length: 20, default: "published" })
  status!: string;

  @Column({ name: "is_featured", type: "boolean", default: false })
  isFeatured!: boolean;

  @Column({ type: "boolean", default: true })
  searchable!: boolean;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
