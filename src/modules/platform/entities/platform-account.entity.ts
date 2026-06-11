import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import {
  PlatformAccountStatus,
  PlatformAccountType,
  PlatformOnboardingMode,
} from '../enums/platform-account.enums';

@Entity('platform_accounts')
@Unique('uq_platform_accounts_tenant', ['tenantId'])
@Index('idx_platform_accounts_account_type', ['accountType'])
@Index('idx_platform_accounts_status', ['status'])
export class PlatformAccountEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'account_type', type: 'varchar', length: 30 })
  accountType!: PlatformAccountType;

  @Column({
    type: 'varchar',
    length: 30,
    default: PlatformAccountStatus.Active,
  })
  status!: PlatformAccountStatus;

  @Column({ name: 'display_name', type: 'varchar', length: 180, nullable: true })
  displayName!: string | null;

  @Column({
    name: 'onboarding_mode',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  onboardingMode!: PlatformOnboardingMode | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  settings!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
