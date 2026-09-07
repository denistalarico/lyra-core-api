import { MODULE_METADATA } from '@nestjs/common/constants';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getMetadataArgsStorage } from 'typeorm';
import { getTypeOrmConfig } from '../../config/typeorm.config';
import { MediaAssetEntity } from './media-asset.entity';
import { MediaAssetsModule } from './media-assets.module';

function column(propertyName: string) {
  const metadata = getMetadataArgsStorage().columns.find(
    (candidate) =>
      candidate.target === MediaAssetEntity &&
      candidate.propertyName === propertyName,
  );

  expect(metadata).toBeDefined();
  return metadata!.options;
}

describe('MediaAssetEntity metadata', () => {
  it('maps the reusable media identity to media_assets', () => {
    const table = getMetadataArgsStorage().tables.find(
      (candidate) => candidate.target === MediaAssetEntity,
    );

    expect(table?.name).toBe('media_assets');
    expect(column('tenantId')).toMatchObject({
      name: 'tenant_id',
      type: 'uuid',
    });
    expect(column('workspaceId')).toMatchObject({
      name: 'workspace_id',
      type: 'uuid',
    });
    expect(column('agencyClientId')).toMatchObject({
      name: 'agency_client_id',
      type: 'uuid',
      nullable: true,
    });
  });

  it('keeps private storage metadata backend-shaped and precision-safe', () => {
    expect(column('storagePath')).toMatchObject({
      name: 'storage_path',
      type: 'varchar',
      length: 512,
    });
    expect(column('mimeType')).toMatchObject({
      name: 'mime_type',
      type: 'varchar',
      length: 128,
    });
    expect(column('byteSize').type).toBe('bigint');
    expect(column('durationMs')).toMatchObject({
      name: 'duration_ms',
      type: 'bigint',
      nullable: true,
    });
    expect(column('originalFilename').nullable).toBe(true);
    expect(column('checksum')).toMatchObject({
      type: 'char',
      length: 64,
      nullable: true,
    });
  });

  it('keeps source as an open varchar vocabulary and metadata non-null', () => {
    const source = column('source');

    expect(source.type).toBe('varchar');
    expect(source.enum).toBeUndefined();
    expect(source.default).toBeUndefined();
    expect(source.nullable).toBeUndefined();
    expect(column('metadata')).toMatchObject({ type: 'jsonb' });
    expect(column('metadata').default).toBeDefined();
  });

  it('defines only scoped, non-unique lookup indexes', () => {
    const indexes = getMetadataArgsStorage().indices.filter(
      (candidate) => candidate.target === MediaAssetEntity,
    );
    const scope = indexes.find(
      (candidate) => candidate.name === 'IDX_media_assets_scope',
    );
    const checksum = indexes.find(
      (candidate) => candidate.name === 'IDX_media_assets_scope_checksum',
    );

    expect(scope?.columns).toEqual([
      'tenantId',
      'workspaceId',
      'agencyClientId',
    ]);
    expect(checksum?.columns).toEqual([
      'tenantId',
      'workspaceId',
      'agencyClientId',
      'checksum',
    ]);
    expect(checksum?.where).toBe('checksum IS NOT NULL');
    expect(scope?.unique).not.toBe(true);
    expect(checksum?.unique).not.toBe(true);
  });
});

describe('MediaAssetsModule wiring', () => {
  it('exports an agency repository registration and no default repository', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      MediaAssetsModule,
    ) as Array<{
      module?: unknown;
      providers?: Array<{ provide?: unknown }>;
    }>;
    const feature = imports.find(
      (candidate) => candidate.module === TypeOrmModule,
    );
    const providerTokens = feature?.providers?.map(
      (provider) => provider.provide,
    );

    expect(providerTokens).toContain(
      getRepositoryToken(MediaAssetEntity, 'agency'),
    );
    expect(providerTokens).not.toContain(getRepositoryToken(MediaAssetEntity));
  });

  it('does not register the entity in the default datasource', () => {
    expect(getTypeOrmConfig().entities).not.toContain(MediaAssetEntity);
  });
});
