jest.mock('@nestjs/typeorm', () => ({
  TypeOrmModule: {
    forFeature: jest.fn(() => class AgencySocialOrganicTypeOrmFeatureModule {}),
  },
}));

import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  SocialOrganicAssetEntity,
  SocialOrganicConnectionEntity,
} from './entities';
import { SocialOrganicModule } from './social-organic.module';

describe('SocialOrganicModule', () => {
  it('boots with both repositories bound to the agency datasource', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SocialOrganicModule],
    }).compile();

    expect((TypeOrmModule.forFeature as jest.Mock).mock.calls).toContainEqual([
      [SocialOrganicConnectionEntity, SocialOrganicAssetEntity],
      'agency',
    ]);
    expect(moduleRef.get(SocialOrganicModule)).toBeInstanceOf(
      SocialOrganicModule,
    );

    await moduleRef.close();
  });
});
