import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";
import { AgencyKnowledgeVaultPermissionRole } from "../enums";

@Entity("agency_knowledge_vault_permissions")
@Index(["tenantId", "workspaceId", "vaultItemId"])
@Index(["tenantId", "workspaceId", "vaultItemId", "userId"], { unique: true })
export class AgencyKnowledgeVaultPermission {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "workspace_id", type: "uuid" })
  workspaceId!: string;

  @Column({ name: "vault_item_id", type: "uuid" })
  vaultItemId!: string;

  @Column({ name: "user_id", type: "uuid", nullable: true })
  userId!: string | null;

  @Column({
    type: "enum",
    enum: AgencyKnowledgeVaultPermissionRole,
    nullable: true,
  })
  role!: AgencyKnowledgeVaultPermissionRole | null;

  @Column({ name: "can_view_metadata", type: "boolean", default: true })
  canViewMetadata!: boolean;

  @Column({ name: "can_reveal_secret", type: "boolean", default: false })
  canRevealSecret!: boolean;

  @Column({ name: "can_edit_secret", type: "boolean", default: false })
  canEditSecret!: boolean;

  @Column({ name: "can_manage_permissions", type: "boolean", default: false })
  canManagePermissions!: boolean;

  @Column({ name: "created_by_id", type: "uuid" })
  createdById!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
