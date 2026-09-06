import { getRepositoryToken } from '@nestjs/typeorm';
import { PRODUCT_ENTITLEMENT_METADATA } from '../../permissions/decorators/permissions.decorators';
import { SocialContentDestinationEntity } from '../../social-planner/entities/social-content-destination.entity';
import { SocialContentItemEntity } from '../../social-planner/entities/social-content-item.entity';
import { SocialOrganicAssetEntity } from '../entities/social-organic-asset.entity';
import { SocialPublicationEntity } from './entities/social-publication.entity';
import { SocialPublicationController } from './social-publication.controller';

describe('Social Publication contract', () => {
  it('keeps every repository the publication service needs on the agency datasource', () => {
    expect(getRepositoryToken(SocialPublicationEntity, 'agency')).toBeDefined();
    expect(getRepositoryToken(SocialContentItemEntity, 'agency')).toBeDefined();
    expect(
      getRepositoryToken(SocialContentDestinationEntity, 'agency'),
    ).toBeDefined();
    expect(
      getRepositoryToken(SocialOrganicAssetEntity, 'agency'),
    ).toBeDefined();
  });

  it('binds publication routes to the Social entitlement', () => {
    expect(
      Reflect.getMetadata(
        PRODUCT_ENTITLEMENT_METADATA,
        SocialPublicationController,
      ),
    ).toBe('social');
  });
});
