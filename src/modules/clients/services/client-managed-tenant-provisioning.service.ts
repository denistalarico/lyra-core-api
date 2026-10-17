import { AgencyClientStatus } from '../enums';
import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AgencyClient } from '../entities/agency-client.entity';
import { PlatformAccountEntity } from '../../platform/entities/platform-account.entity';
import {
  PlatformAccountStatus,
  PlatformAccountType,
} from '../../platform/enums/platform-account.enums';
import { ClientNotificationPublisher } from './client-notification.publisher';

export type CompanyProductContext = {
  tenantId: string;
  workspaceId: string;
  userId: string | null;
};
@Injectable()
export class ClientManagedTenantProvisioningService {
  constructor(
    @InjectDataSource('agency') private readonly db: DataSource,
    private readonly notifications: ClientNotificationPublisher,
  ) {}
  async ensure(
    context: CompanyProductContext,
    clientId: string,
  ): Promise<AgencyClient> {
    let connected = false;
    const client = await this.db.transaction(async (manager) => {
      const result = await this.ensureInTransaction(manager, context, clientId);
      connected = result.connected;
      return result.client;
    });
    if (connected)
      await this.notifications.publishManagedTenantConnected({
        client,
        actorUserId: context.userId,
      });
    return client;
  }
  async ensureInTransaction(
    manager: EntityManager,
    context: CompanyProductContext,
    clientId: string,
  ) {
    const clients = manager.getRepository(AgencyClient);
    const client = await clients.findOne({
      where: {
        id: clientId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !client ||
      client.status !== AgencyClientStatus.Active ||
      client.archivedAt
    )
      throw new NotFoundException('Client not found.');
    if (client.archiveStatus && client.archiveStatus !== 'none')
      throw new ConflictException({
        code: 'client_archive_scheduled',
        message: 'Client archival is pending.',
      });
    if (client.managedTenantId) return { client, connected: false };
    const tenantId = randomUUID();
    await manager.getRepository(PlatformAccountEntity).save({
      tenantId,
      accountType: PlatformAccountType.Business,
      status: PlatformAccountStatus.Active,
      displayName: client.displayName,
      settings: {},
    });
    client.managedTenantId = tenantId;
    return { client: await clients.save(client), connected: true };
  }
}
