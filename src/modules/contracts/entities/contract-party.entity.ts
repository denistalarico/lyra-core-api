import {
Column,
CreateDateColumn,
Entity,
PrimaryGeneratedColumn,
UpdateDateColumn,
} from 'typeorm';
import {
ContractPartyRole,
ContractPartySignatureStatus,
} from '../enums';

@Entity('agency_contract_parties')
export class ContractParty {
@PrimaryGeneratedColumn('uuid')
id!: string;

@Column({ name: 'tenant_id', type: 'uuid' })
tenantId!: string;

@Column({ name: 'workspace_id', type: 'uuid' })
workspaceId!: string;

@Column({ name: 'contract_id', type: 'uuid' })
contractId!: string;

@Column({ type: 'varchar', length: 60 })
role!: ContractPartyRole;

@Column({ name: 'contact_id', type: 'uuid', nullable: true })
contactId!: string | null;

@Column({ name: 'user_id', type: 'uuid', nullable: true })
userId!: string | null;

@Column({ type: 'varchar', length: 160 })
name!: string;

@Column({ type: 'varchar', length: 180, nullable: true })
email!: string | null;

@Column({ type: 'varchar', length: 40, nullable: true })
document!: string | null;

@Column({
name: 'signature_status',
type: 'varchar',
length: 40,
default: ContractPartySignatureStatus.Pending,
})
signatureStatus!: ContractPartySignatureStatus;

@Column({ name: 'signed_at', type: 'timestamptz', nullable: true })
signedAt!: Date | null;

@Column({ name: 'signature_order', type: 'int', default: 1 })
signatureOrder!: number;

@Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
metadata!: Record<string, unknown>;

@CreateDateColumn({ name: 'created_at' })
createdAt!: Date;

@UpdateDateColumn({ name: 'updated_at' })
updatedAt!: Date;
}
