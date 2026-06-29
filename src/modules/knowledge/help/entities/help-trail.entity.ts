import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * Official Help Center learning trail (ordered sequence of articles).
 * GLOBAL / platform-owned: no tenantId / workspaceId.
 */
@Entity("help_trails")
@Index(["key", "locale"], { unique: true })
@Index(["locale", "status"])
export class HelpTrail {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 120 })
  key!: string;

  @Column({ type: "varchar", length: 180 })
  title!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "varchar", length: 160, nullable: true })
  audience!: string | null;

  @Column({ name: "estimated_minutes", type: "int", default: 0 })
  estimatedMinutes!: number;

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
