import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("agency_knowledge_categories")
@Index(["tenantId", "workspaceId"])
@Index(["tenantId", "workspaceId", "slug"], { unique: true })
export class AgencyKnowledgeCategory {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "workspace_id", type: "uuid" })
  workspaceId!: string;

  @Column({ name: "parent_id", type: "uuid", nullable: true })
  parentId!: string | null;

  @Column({ type: "varchar", length: 160 })
  name!: string;

  @Column({ type: "varchar", length: 180 })
  slug!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "varchar", length: 80, nullable: true })
  icon!: string | null;

  @Column({ type: "varchar", length: 32, nullable: true })
  color!: string | null;

  @Column({ name: "sort_order", type: "int", default: 0 })
  sortOrder!: number;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
