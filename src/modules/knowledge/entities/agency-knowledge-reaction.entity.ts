import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";
import { AgencyKnowledgeReactionType } from "../enums";

@Entity("agency_knowledge_reactions")
@Index(["tenantId", "workspaceId", "articleId"])
@Index(["tenantId", "workspaceId", "articleId", "userId", "type"], { unique: true })
export class AgencyKnowledgeReaction {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "workspace_id", type: "uuid" })
  workspaceId!: string;

  @Column({ name: "article_id", type: "uuid" })
  articleId!: string;

  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  @Column({
    type: "enum",
    enum: AgencyKnowledgeReactionType,
  })
  type!: AgencyKnowledgeReactionType;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
