// src/modules/settings/entities/user-profile.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('user_profile')
@Unique('uq_user_profile_tenant_user', ['tenantId', 'userId'])
@Index('idx_user_profile_tenant_user', ['tenantId', 'userId'])
export class UserProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'first_name', type: 'varchar', length: 60, default: '' })
  firstName!: string;

  @Column({ name: 'last_name', type: 'varchar', length: 60, default: '' })
  lastName!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 120, default: '' })
  displayName!: string;

  @Column({ type: 'varchar', length: 160, default: '' })
  email!: string;

  @Column({ name: 'job_title', type: 'varchar', length: 80, nullable: true })
  jobTitle!: string | null;

  @Column({ type: 'varchar', length: 280, nullable: true })
  bio!: string | null;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl!: string | null;

  @Column({
    name: 'avatar_asset_key',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  avatarAssetKey!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
