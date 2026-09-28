import { Module } from '@nestjs/common';
import { PermissionsModule } from '../../permissions';
import { ClientAreaModule } from '../client-area.module';
import { ClientAreaMembersAgencyController } from './client-area-members.agency.controller';

/**
 * CA2 — the Agency-facing side of the Client Area (member management).
 *
 * Separate from `ClientAreaModule` on purpose: the Client Area surface stays
 * free of the Agency permission stack (`PermissionsGuard`,
 * `PlatformPermissionService`, `OperationalContextResolver`); only this
 * Agency controller uses it.
 */
@Module({
  imports: [PermissionsModule, ClientAreaModule],
  controllers: [ClientAreaMembersAgencyController],
})
export class ClientAreaAgencyModule {}
