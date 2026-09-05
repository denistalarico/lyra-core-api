import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  SocialPublishingCadenceChannel,
} from '../contracts';

@Entity('social_publishing_cadences')
@Index('IDX_social_publishing_cadences_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
])
@Check(
  'CK_social_publishing_cadences_channels_array',
  `jsonb_typeof("channels") = 'array'`,
)
export class SocialPublishingCadenceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({
    name: 'agency_client_id',
    type: 'uuid',
    nullable: true,
  })
  agencyClientId!: string | null;

  /**
   * IANA timezone identifier, e.g. America/Sao_Paulo.
   *
   * Scheduling must never depend on the API server timezone.
   */
  @Column({
    type: 'varchar',
    length: 120,
    default: 'America/Sao_Paulo',
  })
  timezone!: string;

  @Column({
    name: 'auto_distribution_enabled',
    type: 'boolean',
    default: false,
  })
  autoDistributionEnabled!: boolean;

  /**
   * Channel-specific frequency and recurring weekly slots.
   *
   * Future format-specific cadence belongs inside the application contract
   * when needed; it does not require another table just to exist.
   */
  @Column({
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  channels!: SocialPublishingCadenceChannel[];

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
