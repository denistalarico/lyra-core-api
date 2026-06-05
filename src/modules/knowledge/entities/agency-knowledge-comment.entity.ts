import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { AgencyKnowledgeCommentStatus } from "../enums";

@Entity("agency_knowledge_comments")
@Index(["tenantId", "workspaceId", "articleId"])
export class AgencyKnowledgeComment {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "workspace_id", type: "uuid" })
  workspaceId!: string;

  @Column({ name: "article_id", type: "uuid" })
  articleId!: string;

  @Column({ name: "author_id", type: "uuid" })
  authorId!: string;

  @Column({ type: "text" })
  body!: string;

  @Column({
    type: "enum",
    enum: AgencyKnowledgeCommentStatus,
    default: AgencyKnowledgeCommentStatus.ACTIVE,
  })
  status!: AgencyKnowledgeCommentStatus;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
