import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('client_area_identity_preferences')
export class ClientAreaIdentityPreferencesEntity {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @PrimaryColumn({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ type: 'varchar', length: 8, default: 'system' }) theme!:
    | 'light'
    | 'dark'
    | 'system';
  @Column({ type: 'varchar', length: 10, default: 'pt-BR' }) locale!:
    | 'pt-BR'
    | 'en'
    | 'es';
}
