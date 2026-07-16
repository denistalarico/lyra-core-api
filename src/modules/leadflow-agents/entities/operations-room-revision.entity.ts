import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('leadflow_operations_room_revision')
export class OperationsRoomRevisionEntity {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'room_version', type: 'bigint', default: 0 })
  roomVersion!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
