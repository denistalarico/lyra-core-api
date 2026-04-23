// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import env from './config/env';
import { getTypeOrmConfig } from './config/typeorm.config';
import { SettingsModule } from './modules/settings/settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [env],
    }),
    TypeOrmModule.forRoot(getTypeOrmConfig()),
    SettingsModule,
  ],
})
export class AppModule {}
