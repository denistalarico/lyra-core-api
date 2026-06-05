import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";
import { AgencyKnowledgeVaultAccessAction } from "../enums";

@Entity("agency_knowledge_vault_access_logs")
@Index(["tenantId", "workspaceId", "vaultItemId"])
@Index(["tenantId", "workspaceId", "userId"])
export class AgencyKnowledgeVaultAccessLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "workspace_id", type: "uuid" })
  workspaceId!: string;

  @Column({ name: "vault_item_id", type: "uuid" })
  vaultItemId!: string;

  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  @Column({
    type: "enum",
    enum: AgencyKnowledgeVaultAccessAction,
  })
  action!: AgencyKnowledgeVaultAccessAction;

  @Column({ name: "ip_address", type: "varchar", length: 80, nullable: true })
  ipAddress!: string | null;

  @Column({ name: "user_agent", type: "text", nullable: true })
  userAgent!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
