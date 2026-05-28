import {
Column,
CreateDateColumn,
Entity,
PrimaryGeneratedColumn,
} from 'typeorm';
import { ContractDocumentType } from '../enums';

@Entity('agency_contract_documents')
export class ContractDocument {
@PrimaryGeneratedColumn('uuid')
id!: string;

@Column({ name: 'tenant_id', type: 'uuid' })
tenantId!: string;

@Column({ name: 'workspace_id', type: 'uuid' })
workspaceId!: string;

@Column({ name: 'contract_id', type: 'uuid' })
contractId!: string;

@Column({ type: 'varchar', length: 60 })
type!: ContractDocumentType;

@Column({ name: 'file_name', type: 'varchar', length: 240, nullable: true })
fileName!: string | null;

@Column({ name: 'file_key', type: 'varchar', length: 500, nullable: true })
fileKey!: string | null;

@Column({ name: 'mime_type', type: 'varchar', length: 120, nullable: true })
mimeType!: string | null;

@Column({ name: 'size_bytes', type: 'bigint', nullable: true })
sizeBytes!: string | null;

@Column({ name: 'external_url', type: 'text', nullable: true })
externalUrl!: string | null;

@Column({ name: 'uploaded_by_id', type: 'uuid', nullable: true })
uploadedById!: string | null;

@Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
metadata!: Record<string, unknown>;

@CreateDateColumn({ name: 'created_at' })
createdAt!: Date;
}
