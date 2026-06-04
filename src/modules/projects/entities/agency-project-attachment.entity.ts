import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('agency_project_attachments')
export class AgencyProjectAttachment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @Column({ name: 'uploaded_by_id', type: 'uuid' })
  uploadedById!: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName!: string;

  @Column({ name: 'file_size', type: 'integer', default: 0 })
  fileSize!: number;

  @Column({ name: 'mime_type', type: 'varchar', length: 128, default: '' })
  mimeType!: string;

  @Column({ name: 'asset_path', type: 'varchar', length: 512 })
  assetPath!: string;

  @Column({ name: 'asset_url', type: 'text' })
  assetUrl!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
