import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ProjectsModule } from '../projects.module';
import { ClientAreaBridgeRegistry } from '../../../common/client-area-bridge/client-area-bridge.registry';
import { NotificationsModule } from '../../notifications/notifications.module';
import { NotificationEventProcessorService } from '../../notifications/services/notification-event-processor.service';
import { PermissionsModule } from '../../permissions/permissions.module';
import { PermissionsGuard } from '../../permissions/guards/permissions.guard';
import type { ClientAreaContext } from '../../client-area/client-area.types';
@Global()
@Module({
  providers: [
    {
      provide: getDataSourceToken('agency'),
      useValue: {
        options: { type: 'postgres' },
        entityMetadatas: [],
        getRepository: () => ({}),
        query: () => Promise.resolve([]),
      },
    },
  ],
  exports: [getDataSourceToken('agency')],
})
class DatabaseFixture {}
@Module({
  providers: [
    {
      provide: NotificationEventProcessorService,
      useValue: { process: jest.fn() },
    },
  ],
  exports: [NotificationEventProcessorService],
})
class NotificationsFixture {}
@Module({
  providers: [
    { provide: PermissionsGuard, useValue: { canActivate: () => true } },
  ],
  exports: [PermissionsGuard],
})
class PermissionsFixture {}
describe('CA9 real ProjectsModule wiring', () => {
  it('registers its scope adapter in the consumer registry during Nest init', async () => {
    const ref = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        DatabaseFixture,
        ProjectsModule,
      ],
    })
      .overrideModule(NotificationsModule)
      .useModule(NotificationsFixture)
      .overrideModule(PermissionsModule)
      .useModule(PermissionsFixture)
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    await ref.init();
    const context = {
      tenantId: 'tenant',
      workspaceId: 'workspace',
      agencyClientId: 'client',
      companyContextId: 'company',
      userId: 'user',
    } as ClientAreaContext;
    expect(
      await ref
        .get(ClientAreaBridgeRegistry)
        .resolveScope(
          'agency_projects',
          context,
          'agency.projects.project.view.assigned',
          { method: 'GET', routePath: '/agency/projects' },
        ),
    ).toMatchObject({
      tenantId: 'tenant',
      workspaceId: 'workspace',
      agencyClientId: 'client',
      companyContextId: 'company',
    });
    await ref.close();
  });
});
