import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AgencyClientLifecycleHooks } from '../clients/agency-client-lifecycle-hooks';
import { ClientsModule } from '../clients/clients.module';
import { PermissionsGuard, PermissionsModule } from '../permissions';
import { ClientAreaAgencyModule } from './agency/client-area-agency.module';
import { ClientAreaModule } from './client-area.module';
import { ClientAreaLifecycleService } from './services/client-area-lifecycle.service';
import { ClientAreaManagementService } from './services/client-area-management.service';
import { ClientAreaSelfAccessService } from './services/client-area-self-access.service';
import { ClientAreaInvitationService } from './services/client-area-invitation.service';
import { ClientAreaMembershipService } from './services/client-area-membership.service';

jest.mock('otplib', () => ({ verify: jest.fn() }));

@Module({
  providers: [AgencyClientLifecycleHooks],
  exports: [AgencyClientLifecycleHooks],
})
class FakeClientsModule {}
@Module({
  providers: [
    {
      provide: ClientAreaLifecycleService,
      useValue: {
        onClientArchived: jest.fn(),
        onCompanyContextArchived: jest.fn(),
      },
    },
    ...[
      ClientAreaManagementService,
      ClientAreaSelfAccessService,
      ClientAreaInvitationService,
      ClientAreaMembershipService,
    ].map((provide) => ({ provide, useValue: {} })),
  ],
  exports: [
    ClientAreaLifecycleService,
    ClientAreaManagementService,
    ClientAreaSelfAccessService,
    ClientAreaInvitationService,
    ClientAreaMembershipService,
  ],
})
class FakeClientAreaModule {}
@Module({})
class FakePermissionsModule {}

describe('CA5 runtime registry wiring', () => {
  it('uses the Clients-owned exported registry and registers the adapter on module init', async () => {
    expect(Reflect.getMetadata('providers', ClientsModule)).toContain(
      AgencyClientLifecycleHooks,
    );
    expect(Reflect.getMetadata('exports', ClientsModule)).toContain(
      AgencyClientLifecycleHooks,
    );
    const ref = await Test.createTestingModule({
      imports: [ClientAreaAgencyModule],
    })
      .overrideModule(ClientsModule)
      .useModule(FakeClientsModule)
      .overrideModule(ClientAreaModule)
      .useModule(FakeClientAreaModule)
      .overrideModule(PermissionsModule)
      .useModule(FakePermissionsModule)
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    await ref.init();
    const event = {
      tenantId: 't',
      workspaceId: 'w',
      agencyClientId: 'c',
      actorUserId: null,
    };
    const handler = jest.spyOn(
      ref.get(ClientAreaLifecycleService),
      'onClientArchived',
    );
    await ref.get(AgencyClientLifecycleHooks).onClientArchived(event);
    expect(handler).toHaveBeenCalledWith(event);
    await ref.close();
  });
});

describe('CA5 reconciler', () => {
  it('retries failed rows, continues to other companies, and never restores access', async () => {
    const company = {
      id: 'company',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      agencyClientId: 'client',
    };
    const builder = {
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      getRawAndEntities: jest.fn().mockResolvedValue({
        entities: [company, { ...company, id: 'company2' }],
        raw: [
          { removal_reason: 'client_archived' },
          { removal_reason: 'company_archived' },
        ],
      }),
    };
    const db = { getRepository: () => ({ createQueryBuilder: () => builder }) };
    const service = new ClientAreaLifecycleService(
      db as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const remove = jest
      .spyOn(service, 'removeCompanyAccess')
      .mockRejectedValueOnce(new Error('retry'))
      .mockResolvedValue({
        enabled: false,
        companyContextId: 'company2',
        revokedMemberships: 0,
        revokedInvitations: 0,
      });
    await service.reconcile();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenLastCalledWith({
      tenantId: 'tenant',
      workspaceId: 'workspace',
      agencyClientId: 'client',
      companyContextId: 'company2',
      actorUserId: null,
      reason: 'company_archived',
    });
    builder.getRawAndEntities.mockResolvedValue({ entities: [], raw: [] });
    await service.reconcile();
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
