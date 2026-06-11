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
  PlatformProductKey,
  ProductEntitlementSource,
  ProductEntitlementStatus,
} from '../enums/platform-product.enums';

@Entity('tenant_product_entitlements')
@Unique('uq_tenant_product_entitlements_tenant_product', [
  'tenantId',
  'productKey',
])
@Index('idx_tenant_product_entitlements_tenant', ['tenantId'])
@Index('idx_tenant_product_entitlements_tenant_status', ['tenantId', 'status'])
export class TenantProductEntitlementEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'product_key', type: 'varchar', length: 30 })
  productKey!: PlatformProductKey;

  @Column({ type: 'varchar', length: 30 })
  status!: ProductEntitlementStatus;

  @Column({ type: 'varchar', length: 30 })
  source!: ProductEntitlementSource;

  @Column({ name: 'plan_key', type: 'varchar', length: 80, nullable: true })
  planKey!: string | null;

  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt!: Date | null;

  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt!: Date | null;

  @Column({ name: 'trial_ends_at', type: 'timestamptz', nullable: true })
  trialEndsAt!: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  settings!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
