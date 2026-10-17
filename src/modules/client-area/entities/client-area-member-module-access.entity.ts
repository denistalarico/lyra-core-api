import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type {
  ClientAreaAccessLevel,
  ClientAreaModuleKey,
} from '../client-area.types';

@Entity('client_area_member_module_access')
@Unique('UQ_client_area_member_module_access', ['membershipId', 'moduleKey'])
export class ClientAreaMemberModuleAccessEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'membership_id', type: 'uuid' }) membershipId!: string;
  @Column({ name: 'module_key', type: 'varchar', length: 40 })
  moduleKey!: ClientAreaModuleKey;
  @Column({ type: 'varchar', length: 16 }) level!: ClientAreaAccessLevel;
  @Column({ name: 'granted_by_user_id', type: 'uuid', nullable: true })
  grantedByUserId!: string | null;
  @Column({ name: 'granted_by_surface', type: 'varchar', length: 16 })
  grantedBySurface!: 'agency' | 'client_area';
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
