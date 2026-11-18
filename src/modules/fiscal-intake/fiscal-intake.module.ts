import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencySettingsModule } from '../agency/agency-settings.module';
import { AgencyWorkspaceUserEntity } from '../agency/entities/agency-settings.entities';
import { EmailModule } from '../email/email.module';
import { FinanceFiscalProfile } from '../finance/entities/finance-fiscal-profile.entity';
import { NotificationsModule } from '../notifications';
import { PermissionsModule } from '../permissions';
import { FiscalIntakeRequestEntity } from './entities/fiscal-intake-request.entity';
import { FiscalProfileAuditEventEntity } from './entities/fiscal-profile-audit-event.entity';
import { FiscalCertificateCrypto } from './fiscal-certificate.crypto';
import {
  FiscalIntakeController,
  PublicFiscalIntakeController,
} from './fiscal-intake.controller';
import {
  FiscalIntakeService,
  FiscalProfileReader,
} from './fiscal-intake.service';

/**
 * Forms addon F5 (2026-11-17): accountant fiscal intake + encrypted A1.
 * Plan: docs/sprints/forms-addon-implementation-plan-2026-11-17.md (§8).
 * Not gated by the Forms addon toggle: it belongs to Finance's fiscal profile.
 */
@Module({
  imports: [
    PermissionsModule,
    AgencySettingsModule,
    EmailModule,
    NotificationsModule,
    TypeOrmModule.forFeature(
      [
        FiscalIntakeRequestEntity,
        FiscalProfileAuditEventEntity,
        FinanceFiscalProfile,
        AgencyWorkspaceUserEntity,
      ],
      'agency',
    ),
  ],
  controllers: [FiscalIntakeController, PublicFiscalIntakeController],
  providers: [
    FiscalCertificateCrypto,
    FiscalIntakeService,
    FiscalProfileReader,
  ],
  exports: [FiscalProfileReader],
})
export class FiscalIntakeModule {}
