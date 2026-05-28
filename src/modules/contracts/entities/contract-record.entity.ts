import {
Column,
CreateDateColumn,
Entity,
PrimaryGeneratedColumn,
UpdateDateColumn,
} from 'typeorm';
import {
ContractSignatureMode,
ContractSignatureProvider,
ContractStatus,
ContractTargetType,
} from '../enums';

@Entity('agency_contract_records')
export class ContractRecord {
@PrimaryGeneratedColumn('uuid')
id!: string;

@Column({ name: 'tenant_id', type: 'uuid' })
tenantId!: string;

@Column({ name: 'workspace_id', type: 'uuid' })
workspaceId!: string;

@Column({ type: 'varchar', length: 180 })
title!: string;

@Column({ name: 'target_type', type: 'varchar', length: 60 })
targetType!: ContractTargetType;

@Column({ name: 'target_id', type: 'uuid', nullable: true })
targetId!: string | null;

@Column({ name: 'template_id', type: 'uuid', nullable: true })
templateId!: string | null;

@Column({ name: 'template_version_id', type: 'uuid', nullable: true })
templateVersionId!: string | null;

@Column({ type: 'varchar', length: 40, default: ContractStatus.Draft })
status!: ContractStatus;

@Column({
name: 'signature_mode',
type: 'varchar',
length: 40,
default: ContractSignatureMode.Manual,
})
signatureMode!: ContractSignatureMode;

@Column({
name: 'signature_provider',
type: 'varchar',
length: 40,
default: ContractSignatureProvider.None,
})
signatureProvider!: ContractSignatureProvider;

@Column({ name: 'external_document_id', type: 'varchar', length: 160, nullable: true })
externalDocumentId!: string | null;

@Column({ name: 'variables_data', type: 'jsonb', default: () => "'{}'::jsonb" })
variablesData!: Record<string, unknown>;

@Column({ name: 'generated_html', type: 'text', nullable: true })
generatedHtml!: string | null;

@Column({ name: 'valid_from', type: 'date', nullable: true })
validFrom!: string | null;

@Column({ name: 'valid_until', type: 'date', nullable: true })
validUntil!: string | null;

@Column({ name: 'signed_at', type: 'timestamptz', nullable: true })
signedAt!: Date | null;

@Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
completedAt!: Date | null;

@Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
cancelledAt!: Date | null;

@Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
archivedAt!: Date | null;

@Column({ name: 'created_by_id', type: 'uuid', nullable: true })
createdById!: string | null;

@Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
updatedById!: string | null;

@Column({ name: 'cancelled_by_id', type: 'uuid', nullable: true })
cancelledById!: string | null;

@Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
metadata!: Record<string, unknown>;

@CreateDateColumn({ name: 'created_at' })
createdAt!: Date;

@UpdateDateColumn({ name: 'updated_at' })
updatedAt!: Date;
}
