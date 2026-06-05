import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import {
  AgencyKnowledgeArticleStatus,
  AgencyKnowledgeArticleType,
  AgencyKnowledgeArticleVisibility,
} from "../enums";

@Entity("agency_knowledge_articles")
@Index(["tenantId", "workspaceId"])
@Index(["tenantId", "workspaceId", "slug"], { unique: true })
@Index(["tenantId", "workspaceId", "status"])
@Index(["tenantId", "workspaceId", "type"])
export class AgencyKnowledgeArticle {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "workspace_id", type: "uuid" })
  workspaceId!: string;

  @Column({ name: "category_id", type: "uuid", nullable: true })
  categoryId!: string | null;

  @Column({ name: "author_id", type: "uuid" })
  authorId!: string;

  @Column({ name: "owner_id", type: "uuid", nullable: true })
  ownerId!: string | null;

  @Column({ name: "client_id", type: "uuid", nullable: true })
  clientId!: string | null;

  @Column({ name: "project_id", type: "uuid", nullable: true })
  projectId!: string | null;

  @Column({ name: "task_id", type: "uuid", nullable: true })
  taskId!: string | null;

  @Column({ type: "varchar", length: 220 })
  title!: string;

  @Column({ type: "varchar", length: 240 })
  slug!: string;

  @Column({ type: "text", nullable: true })
  summary!: string | null;

  @Column({
    type: "enum",
    enum: AgencyKnowledgeArticleType,
    default: AgencyKnowledgeArticleType.ARTICLE,
  })
  type!: AgencyKnowledgeArticleType;

  @Column({
    type: "enum",
    enum: AgencyKnowledgeArticleStatus,
    default: AgencyKnowledgeArticleStatus.DRAFT,
  })
  status!: AgencyKnowledgeArticleStatus;

  @Column({
    type: "enum",
    enum: AgencyKnowledgeArticleVisibility,
    default: AgencyKnowledgeArticleVisibility.INTERNAL,
  })
  visibility!: AgencyKnowledgeArticleVisibility;

  @Column({ name: "header_json", type: "jsonb", default: () => "'{}'::jsonb" })
  headerJson!: Record<string, unknown>;

  @Column({ name: "content_json", type: "jsonb", default: () => "'[]'::jsonb" })
  contentJson!: Record<string, unknown>[];

  @Column({ name: "content_html", type: "text", nullable: true })
  contentHtml!: string | null;

  @Column({ name: "footer_json", type: "jsonb", default: () => "'{}'::jsonb" })
  footerJson!: Record<string, unknown>;

  @Column({ type: "text", array: true, default: "{}" })
  tags!: string[];

  @Column({ name: "is_pinned", type: "boolean", default: false })
  isPinned!: boolean;

  @Column({ name: "is_featured", type: "boolean", default: false })
  isFeatured!: boolean;

  @Column({ name: "is_onboarding_required", type: "boolean", default: false })
  isOnboardingRequired!: boolean;

  @Column({ name: "estimated_read_minutes", type: "int", default: 1 })
  estimatedReadMinutes!: number;

  @Column({ name: "review_at", type: "timestamptz", nullable: true })
  reviewAt!: Date | null;

  @Column({ name: "published_at", type: "timestamptz", nullable: true })
  publishedAt!: Date | null;

  @Column({ name: "archived_at", type: "timestamptz", nullable: true })
  archivedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
