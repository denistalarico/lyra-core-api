import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import {
  AgencyKnowledgeScope,
  AgencyKnowledgeVaultServiceType,
  AgencyKnowledgeVaultStatus,
} from "../enums";

@Entity("agency_knowledge_vault_items")
@Index(["tenantId", "workspaceId"])
@Index(["tenantId", "workspaceId", "clientId"])
@Index(["tenantId", "workspaceId", "articleId"])
export class AgencyKnowledgeVaultItem {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "workspace_id", type: "uuid" })
  workspaceId!: string;

  @Column({ name: "client_id", type: "uuid", nullable: true })
  clientId!: string | null;

  @Column({ name: "article_id", type: "uuid", nullable: true })
  articleId!: string | null;

  @Column({ type: "varchar", length: 180 })
  title!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({
    name: "service_type",
    type: "enum",
    enum: AgencyKnowledgeVaultServiceType,
    default: AgencyKnowledgeVaultServiceType.OTHER,
  })
  serviceType!: AgencyKnowledgeVaultServiceType;

  @Column({ name: "service_url", type: "text", nullable: true })
  serviceUrl!: string | null;

  @Column({ name: "login_identifier", type: "varchar", length: 240, nullable: true })
  loginIdentifier!: string | null;

  @Column({ name: "encrypted_secret", type: "text" })
  encryptedSecret!: string;

  @Column({ name: "encrypted_notes", type: "text", nullable: true })
  encryptedNotes!: string | null;

  @Column({ name: "encrypted_notes_iv", type: "varchar", length: 64, nullable: true })
  encryptedNotesIv!: string | null;

  @Column({ name: "encrypted_notes_auth_tag", type: "varchar", length: 64, nullable: true })
  encryptedNotesAuthTag!: string | null;

  @Column({ name: "encryption_iv", type: "varchar", length: 64 })
  encryptionIv!: string;

  @Column({ name: "encryption_auth_tag", type: "varchar", length: 64 })
  encryptionAuthTag!: string;

  @Column({ name: "key_version", type: "int", default: 1 })
  keyVersion!: number;

  @Column({
    type: "enum",
    enum: AgencyKnowledgeVaultStatus,
    default: AgencyKnowledgeVaultStatus.ACTIVE,
  })
  status!: AgencyKnowledgeVaultStatus;

  @Column({
    type: "varchar",
    length: 20,
    default: AgencyKnowledgeScope.SHARED,
  })
  scope!: AgencyKnowledgeScope;

  @Column({ name: "created_by_id", type: "uuid" })
  createdById!: string;

  @Column({ name: "updated_by_id", type: "uuid", nullable: true })
  updatedById!: string | null;

  @Column({ name: "last_revealed_at", type: "timestamptz", nullable: true })
  lastRevealedAt!: Date | null;

  @Column({ name: "archived_at", type: "timestamptz", nullable: true })
  archivedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
