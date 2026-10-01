import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { EmailModule } from '../email/email.module';
import { AgencyIdentityCredentialsService } from './agency-identity-credentials.service';
import { AGENCY_IDENTITY_CREDENTIALS } from './agency-identity-credentials.token';
import {
  AgencyEmailTwoFactorCodeEntity,
  AgencyUserLoginEventEntity,
  AgencyUserSecuritySettingsEntity,
} from './entities/agency-auth.entities';
import { AgencyWorkspaceEmailSettingsEntity } from './entities/agency-settings.entities';

const AGENCY_CONNECTION = 'agency';

/** Identity credential primitives shared by the Agency and Client Area auth. */
@Module({
  imports: [
    EmailModule,
    TypeOrmModule.forFeature(
      [
        AgencyUserSecuritySettingsEntity,
        AgencyEmailTwoFactorCodeEntity,
        AgencyUserLoginEventEntity,
        AgencyWorkspaceEmailSettingsEntity,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  providers: [
    AgencyIdentityCredentialsService,
    SettingsCryptoService,
    // Alias for consumers that must not value-import the class (see the
    // token's own file: the class drags `otplib` into their module graph).
    {
      provide: AGENCY_IDENTITY_CREDENTIALS,
      useExisting: AgencyIdentityCredentialsService,
    },
  ],
  exports: [AgencyIdentityCredentialsService, AGENCY_IDENTITY_CREDENTIALS],
})
export class AgencyIdentityCredentialsModule {}
