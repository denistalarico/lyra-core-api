import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Minimal operational trail. Never holds tokens, codes, state or emails. */
@Entity('social_google_audit_events')
@Index('IDX_social_google_audit_events_authorization', [
  'authorizationId',
  'createdAt',
])
export class SocialGoogleAuditEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'authorization_id', type: 'uuid', nullable: true })
  authorizationId!: string | null;

  @Column({ type: 'varchar', length: 48 })
  event!: string;

  @Column({ type: 'varchar', length: 24, nullable: true })
  product!: string | null;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  detail!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
