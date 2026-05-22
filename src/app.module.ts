// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import env from './config/env';
import {
  getAgencyTypeOrmConfig,
  getTypeOrmConfig,
} from './config/typeorm.config';
import { SettingsModule } from './modules/settings/settings.module';
import { AuthModule } from './modules/auth/auth.module';
import { EmailModule } from './modules/email/email.module';
import { FilesModule } from './common/files/files.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { WebchatModule } from './modules/webchat/webchat.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { InboxModule } from './modules/inbox/inbox.module';
import { CrmModule } from './modules/crm/crm.module';
import { AgencyAuthModule } from './modules/agency/agency-auth.module';
import { AgencySettingsModule } from './modules/agency/agency-settings.module';
import { AgencySalesModule } from './modules/agency/agency-sales.module';
import { AgencyContactsModule } from './modules/agency/agency-contacts.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [env],
    }),
    TypeOrmModule.forRoot(getTypeOrmConfig()),
    TypeOrmModule.forRoot(getAgencyTypeOrmConfig()),
    SettingsModule,
    AuthModule,
    EmailModule,
    FilesModule,
    ContactsModule,
    WebchatModule,
    AppointmentsModule,
    InboxModule,
    CrmModule,
    AgencyAuthModule,
    AgencySettingsModule,
    AgencySalesModule,
    AgencyContactsModule,
  ],
})
export class AppModule {}
