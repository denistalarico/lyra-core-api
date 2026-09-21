import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('social_creative_folders')
@Index('IDX_social_creative_folders_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
])
@Index('IDX_social_creative_folders_parent', ['parentId'])
export class CreativeFolderEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;
  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;
  @Column({ type: 'varchar', length: 160 }) name!: string;
  @Column({ name: 'parent_id', type: 'uuid', nullable: true }) parentId!:
    | string
    | null;
  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
