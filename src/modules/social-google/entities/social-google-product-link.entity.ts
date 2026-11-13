import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  GoogleProduct,
  GoogleProductLinkStatus,
} from '../google-oauth.constants';

/**
 * A product (GA4, Ads, Business Profile) enabled on an authorization.
 *
 * `resources` is the extension point for later phases (properties, customer
 * ids, locations). This phase never writes to it.
 */
@Entity('social_google_product_links')
@Index(
  'UQ_social_google_product_links_authorization_product',
  ['authorizationId', 'product'],
  { unique: true },
)
export class SocialGoogleProductLinkEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'authorization_id', type: 'uuid' })
  authorizationId!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 24 })
  product!: GoogleProduct;

  @Column({ type: 'varchar', length: 16, default: 'connected' })
  status!: GoogleProductLinkStatus;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  resources!: unknown[];

  @Column({ name: 'connected_at', type: 'timestamptz', nullable: true })
  connectedAt!: Date | null;

  @Column({ name: 'disconnected_at', type: 'timestamptz', nullable: true })
  disconnectedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
