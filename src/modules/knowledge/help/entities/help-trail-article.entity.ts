import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

/**
 * Join between a Help Center trail and an article, with ordering.
 * GLOBAL / platform-owned.
 */
@Entity("help_trail_articles")
@Index(["trailId", "articleId"], { unique: true })
@Index(["trailId", "sortOrder"])
export class HelpTrailArticle {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "trail_id", type: "uuid" })
  trailId!: string;

  @Column({ name: "article_id", type: "uuid" })
  articleId!: string;

  @Column({ name: "sort_order", type: "int", default: 0 })
  sortOrder!: number;

  @Column({ type: "boolean", default: true })
  required!: boolean;

  @Column({ name: "estimated_minutes", type: "int", nullable: true })
  estimatedMinutes!: number | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
