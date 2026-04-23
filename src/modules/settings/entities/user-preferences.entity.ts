// src/modules/settings/entities/user-preferences.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('user_preferences')
@Unique('uq_user_preferences_tenant_user', ['tenantId', 'userId'])
@Index('idx_user_preferences_tenant_user', ['tenantId', 'userId'])
export class UserPreferencesEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({
    name: 'theme_preference',
    type: 'varchar',
    length: 20,
    default: 'system',
  })
  themePreference!: 'light' | 'dark' | 'system';

  @Column({ type: 'varchar', length: 10, default: 'pt-BR' })
  locale!: 'pt-BR' | 'en' | 'es';

  @Column({ type: 'varchar', length: 80, default: 'America/Sao_Paulo' })
  timezone!: string;

  @Column({
    name: 'date_format',
    type: 'varchar',
    length: 20,
    default: 'dd/MM/yyyy',
  })
  dateFormat!: string;

  @Column({ name: 'time_format', type: 'varchar', length: 10, default: '24h' })
  timeFormat!: '12h' | '24h';

  @Column({ name: 'sidebar_collapsed', type: 'boolean', default: false })
  sidebarCollapsed!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
