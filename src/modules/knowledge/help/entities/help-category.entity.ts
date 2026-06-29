import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * Official Help Center category. GLOBAL / platform-owned: intentionally has no
 * tenantId / workspaceId. Never mix with AgencyKnowledgeCategory (tenant data).
 */
@Entity("help_categories")
@Index(["key", "locale"], { unique: true })
@Index(["locale", "status"])
export class HelpCategory {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 120 })
  key!: string;

  @Column({ type: "varchar", length: 180 })
  title!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "varchar", length: 80, nullable: true })
  icon!: string | null;

  @Column({ type: "varchar", length: 32, nullable: true })
  color!: string | null;

  @Column({ name: "product_key", type: "varchar", length: 80, default: "lyra-agency" })
  productKey!: string;

  @Column({ name: "module_key", type: "varchar", length: 80, nullable: true })
  moduleKey!: string | null;

  @Column({ name: "sort_order", type: "int", default: 0 })
  sortOrder!: number;

  @Column({ type: "varchar", length: 8, default: "pt-BR" })
  locale!: string;

  @Column({ type: "varchar", length: 20, default: "published" })
  status!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
