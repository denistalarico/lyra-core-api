import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ActivityEntityType, ActivityRelationType } from '../enums';

@Entity('agency_activity_links')
export class AgencyActivityLink {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'activity_id', type: 'uuid' })
  activityId!: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 80 })
  entityType!: ActivityEntityType;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId!: string;

  @Column({
    name: 'relation_type',
    type: 'varchar',
    length: 80,
    default: ActivityRelationType.RelatedTo,
  })
  relationType!: ActivityRelationType;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
