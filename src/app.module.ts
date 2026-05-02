// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import env from './config/env';
import { getTypeOrmConfig } from './config/typeorm.config';
import { SettingsModule } from './modules/settings/settings.module';
import { AuthModule } from './modules/auth/auth.module';
import { EmailModule } from './modules/email/email.module';
import { FilesModule } from './common/files/files.module';
import { ContactsModule } from './modules/contacts/contacts.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [env],
    }),
    TypeOrmModule.forRoot(getTypeOrmConfig()),
    SettingsModule,
    AuthModule,
    EmailModule,
    FilesModule,
    ContactsModule,
  ],
})
export class AppModule {}
