import { ContractDefaultsService } from './services/contract-defaults.service';
import { ContractAdjustmentIndexService } from './services/contract-adjustment-index.service';
import { Module } from '@nestjs/common';
import { AiCostsModule } from '../ai-costs/ai-costs.module';
import { AgencyIdentityCredentialsModule } from '../agency/agency-identity-credentials.module';
import { EmailModule } from '../email/email.module';
import { ContractAiAssistController } from './ai-assist/contract-ai-assist.controller';
import { ContractAiAssistService } from './ai-assist/contract-ai-assist.service';
import { ContractAiAssistConfigService } from './ai-assist/contract-ai-assist-config.service';
import { ContractAiAssistProvider } from './ai-assist/contract-ai-assist.provider';
import { ContractAiAssistRun } from './entities/contract-ai-assist-run.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutentiqueWebhookController } from './controllers/autentique-webhook.controller';
import { ContractsController } from './controllers/contracts.controller';
import { ContractsService } from './services/contracts.service';
import { NotificationsModule } from '../notifications';
import { PermissionsModule } from '../permissions';
import { ContractNotificationPublisher } from './services/contract-notification.publisher';
import { TeamContractLifecycleNotificationsService } from './services/team-contract-lifecycle-notifications.service';
import { WorkspaceUserEntity } from '../settings/entities/workspace-user.entity';
import { TeamMember } from '../team/entities';
import {
  ContractDefaults,
  ContractDocument,
  ContractEvent,
  ContractParty,
  ContractRecord,
  ContractTemplate,
  ContractTemplateVersion,
  ContractSignatureProviderSetting,
} from './entities';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    AiCostsModule,
    // Signing links e-mailed by Lyra, through the agency SMTP when configured.
    AgencyIdentityCredentialsModule,
    EmailModule,
    NotificationsModule,
    PermissionsModule,
    TypeOrmModule.forFeature(
      [
        ContractDefaults,
        ContractAiAssistRun,
        ContractTemplate,
        ContractTemplateVersion,
        ContractSignatureProviderSetting,
        ContractRecord,
        ContractParty,
        ContractDocument,
        ContractEvent,
        WorkspaceUserEntity,
        TeamMember,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [
    ContractAiAssistController,
    AutentiqueWebhookController,
    ContractsController,
  ],
  providers: [
    ContractsService,
    ContractDefaultsService,
    ContractAdjustmentIndexService,
    ContractNotificationPublisher,
    TeamContractLifecycleNotificationsService,
    ContractAiAssistConfigService,
    ContractAiAssistProvider,
    ContractAiAssistService,
  ],
  exports: [ContractsService],
})
export class ContractsModule {}
