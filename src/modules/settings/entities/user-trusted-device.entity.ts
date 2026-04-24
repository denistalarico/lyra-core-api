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
export class UserTrustedDeviceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 120 })
  browser!: string;

  @Column({ type: 'varchar', length: 120 })
  location!: string;

  @Column({ name: 'last_seen', type: 'varchar', length: 120 })
  lastSeen!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: 'trusted' | 'recent' | 'inactive';

  @Column({ name: 'trusted_at', type: 'timestamptz', nullable: true })
  trustedAt!: Date | null;

  @Column({ name: 'removed_at', type: 'timestamptz', nullable: true })
  removedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
