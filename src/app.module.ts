// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
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
import { QuotesModule } from './modules/quotes/quotes.module';
import { DocumentLayoutsModule } from './modules/document-layouts/document-layouts.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { ProjectsModule } from './modules/projects';
import { ActivitiesModule } from './modules/activities';
import { FinanceModule } from './modules/finance';
import { ContractsModule } from './modules/contracts';
import { TeamModule } from './modules/team';
import { ClientsModule } from './modules/clients';
import { KnowledgeModule } from './modules/knowledge';
import { TeamChatModule } from './modules/team-chat/team-chat.module';
import { PlatformModule } from './modules/platform';
import { DashboardsModule } from './modules/dashboards';
import { NotificationsModule } from './modules/notifications';
import { PermissionsModule } from './modules/permissions';

@Module({
  imports: [
    TeamChatModule,
    QuotesModule,
    DocumentLayoutsModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [env],
    }),
    ScheduleModule.forRoot(),
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
    CalendarModule,
    ProjectsModule,
    ActivitiesModule,
    FinanceModule,
    ContractsModule,
    TeamModule,
    ClientsModule,
    KnowledgeModule,
    PlatformModule,
    DashboardsModule,
    NotificationsModule,
    PermissionsModule,
  ],
})
export class AppModule {}
