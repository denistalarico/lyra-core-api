import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("agency_knowledge_quick_notes")
@Index(["tenantId", "workspaceId"])
export class AgencyKnowledgeQuickNote {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "workspace_id", type: "uuid" })
  workspaceId!: string;

  @Column({ name: "author_id", type: "uuid" })
  authorId!: string;

  @Column({ name: "author_name", type: "varchar", length: 120 })
  authorName!: string;

  @Column({ type: "varchar", length: 220 })
  title!: string;

  @Column({ type: "text", nullable: true })
  body!: string | null;

  @Column({ type: "varchar", length: 32, nullable: true })
  color!: string | null;

  @Column({ type: "text", array: true, default: "{}" })
  tags!: string[];

  @Column({ name: "position_x", type: "float", default: 0 })
  positionX!: number;

  @Column({ name: "position_y", type: "float", default: 0 })
  positionY!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
