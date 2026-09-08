import { getMetadataArgsStorage } from 'typeorm';
import {
  SocialOrganicAssetEntity,
  SocialOrganicConnectionEntity,
} from './index';

type OrganicEntity =
  | typeof SocialOrganicConnectionEntity
  | typeof SocialOrganicAssetEntity;

function columnOptions(target: OrganicEntity, propertyName: string) {
  const column = getMetadataArgsStorage().columns.find(
    (candidate) =>
      candidate.target === target && candidate.propertyName === propertyName,
  );

  expect(column).toBeDefined();
  return column!.options;
}

describe('social organic entity credential metadata', () => {
  it.each([
    [SocialOrganicConnectionEntity, 'accessTokenEncrypted'],
    [SocialOrganicConnectionEntity, 'refreshTokenEncrypted'],
    [SocialOrganicAssetEntity, 'assetTokenEncrypted'],
  ])('marks %p.%s as select:false', (target, propertyName) => {
    expect(columnOptions(target, propertyName).select).toBe(false);
  });

  it('keeps provider and asset type as varchar columns without defaults', () => {
    const providerColumns = [
      columnOptions(SocialOrganicConnectionEntity, 'provider'),
      columnOptions(SocialOrganicAssetEntity, 'provider'),
    ];
    const assetType = columnOptions(SocialOrganicAssetEntity, 'assetType');

    for (const provider of providerColumns) {
      expect(provider.type).toBe('varchar');
      expect(provider.default).toBeUndefined();
      expect(provider.enum).toBeUndefined();
    }
    expect(assetType.type).toBe('varchar');
    expect(assetType.default).toBeUndefined();
    expect(assetType.enum).toBeUndefined();
  });

  it('keeps asset timezone nullable and without a default', () => {
    const timezone = columnOptions(SocialOrganicAssetEntity, 'assetTimezone');

    expect(timezone.type).toBe('varchar');
    expect(timezone.length).toBe(64);
    expect(timezone.nullable).toBe(true);
    expect(timezone.default).toBeUndefined();
  });
});
