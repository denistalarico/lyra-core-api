import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("agency_knowledge_article_versions")
@Index(["tenantId", "workspaceId", "articleId"])
export class AgencyKnowledgeArticleVersion {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "workspace_id", type: "uuid" })
  workspaceId!: string;

  @Column({ name: "article_id", type: "uuid" })
  articleId!: string;

  @Column({ name: "version_number", type: "int" })
  versionNumber!: number;

  @Column({ type: "varchar", length: 220 })
  title!: string;

  @Column({ name: "header_json", type: "jsonb", default: () => "'{}'::jsonb" })
  headerJson!: Record<string, unknown>;

  @Column({ name: "content_json", type: "jsonb", default: () => "'[]'::jsonb" })
  contentJson!: Record<string, unknown>[];

  @Column({ name: "content_html", type: "text", nullable: true })
  contentHtml!: string | null;

  @Column({ name: "footer_json", type: "jsonb", default: () => "'{}'::jsonb" })
  footerJson!: Record<string, unknown>;

  @Column({ name: "changed_by_id", type: "uuid" })
  changedById!: string;

  @Column({ name: "change_note", type: "text", nullable: true })
  changeNote!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
