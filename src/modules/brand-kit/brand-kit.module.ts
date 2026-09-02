// src/modules/brand-kit/brand-kit.module.ts
//
// Brand Kit domain (Lyra Social S1.4.9) — visual identity for the agency or
// one managed client, with binaries in the PRIVATE bucket.
//
// A module of its own, not part of `social-integrations` or
// `leadflow-settings`: the architecture places Brand Kit in the Content &
// Creative Layer, to be consumed later by Creative Studio, the Intelligence
// Layer and external integrations (D-8).

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesModule } from '../../common/files/files.module';
import { PermissionsModule } from '../permissions';
import { BrandKitController } from './brand-kit.controller';
import { BrandKitAssetEntity, BrandKitEntity } from './entities';
import { BrandKitService } from './services/brand-kit.service';

@Module({
  imports: [
    PermissionsModule,
    FilesModule,
    TypeOrmModule.forFeature([BrandKitEntity, BrandKitAssetEntity], 'agency'),
  ],
  controllers: [BrandKitController],
  providers: [BrandKitService],
  // Exported for the future consumers the architecture names (Creative
  // Studio, Pletor): they must read Brand Kit through this service, never by
  // building a storage URL by hand.
  exports: [BrandKitService],
})
export class BrandKitModule {}
