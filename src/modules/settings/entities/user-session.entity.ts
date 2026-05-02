import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('user_sessions')
@Index('idx_user_sessions_tenant_user', ['tenantId', 'userId'])
export class UserSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'session_token_hash', type: 'text', nullable: true })
  sessionTokenHash!: string | null;

  @Column({ type: 'varchar', length: 120 })
  title!: string;

  @Column({ type: 'varchar', length: 120 })
  browser!: string;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({
    name: 'accept_language',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  acceptLanguage!: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 120, nullable: true })
  ipAddress!: string | null;

  @Column({
    name: 'device_fingerprint',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  deviceFingerprint!: string | null;

  @Column({ name: 'device_name', type: 'varchar', length: 120, nullable: true })
  deviceName!: string | null;

  @Column({ type: 'varchar', length: 120 })
  location!: string;

  @Column({ name: 'last_seen', type: 'varchar', length: 120 })
  lastSeen!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: 'current' | 'active' | 'expired';

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
