import { ClientAreaAccessAgencyController } from './client-area-access.agency.controller';
import { Module, type OnModuleInit } from '@nestjs/common';
import { ClientsModule } from '../../clients/clients.module';
import { AgencyClientLifecycleHooks } from '../../clients/agency-client-lifecycle-hooks';
import { ClientAreaLifecycleService } from '../services/client-area-lifecycle.service';
import { PermissionsModule } from '../../permissions';
import { ClientAreaModule } from '../client-area.module';
import { ClientAreaMembersAgencyController } from './client-area-members.agency.controller';
import { ClientAreaManagementAgencyController } from './client-area-management.agency.controller';

/**
 * CA2 — the Agency-facing side of the Client Area (member management).
 *
 * Separate from `ClientAreaModule` on purpose: the Client Area surface stays
 * free of the Agency permission stack (`PermissionsGuard`,
 * `PlatformPermissionService`, `OperationalContextResolver`); only this
 * Agency controller uses it.
 */
@Module({
  imports: [PermissionsModule, ClientAreaModule, ClientsModule],
  controllers: [
    ClientAreaAccessAgencyController,
    ClientAreaMembersAgencyController,
    ClientAreaManagementAgencyController,
  ],
})
export class ClientAreaAgencyModule implements OnModuleInit {
  constructor(
    private readonly hooks: AgencyClientLifecycleHooks,
    private readonly lifecycle: ClientAreaLifecycleService,
  ) {}
  onModuleInit() {
    this.hooks.register(this.lifecycle);
  }
}
