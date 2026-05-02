import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('user_trusted_devices')
@Index('idx_user_trusted_devices_tenant_user', ['tenantId', 'userId'])
@Index('idx_user_trusted_devices_tenant_user_device', [
  'tenantId',
  'userId',
  'deviceFingerprint',
])
export class UserTrustedDeviceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({
    name: 'device_fingerprint',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  deviceFingerprint!: string | null;

  @Column({
    name: 'device_name',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  deviceName!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 120, nullable: true })
  ipAddress!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  location!: string | null;

  @Column({ name: 'trusted_at', type: 'timestamptz', nullable: true })
  trustedAt!: Date | null;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
