import { AuditChangeService } from './services/audit-change.service';
import { ClientAreaSettingsRegistry } from '../../common/client-area-bridge/client-area-settings.registry';
import { ClientAreaSessionService } from './services/client-area-session.service';
import { ClientAreaAuthorizationService } from './services/client-area-authorization.service';
import type { ClientAreaContext } from './client-area.types';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ClientAreaModule } from './client-area.module';
import { ClientAreaBridgeRegistry } from '../../common/client-area-bridge/client-area-bridge.registry';
import { ClientAreaBridgeAuthenticator } from './services/client-area-bridge-authenticator';
import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { AuditChangeInterceptor } from './services/audit-change.interceptor';
import { ClientAreaMemberAccessService } from './services/client-area-member-access.service';
import { ActorDirectoryService } from './services/actor-directory.service';

jest.mock('otplib', () => ({ verify: jest.fn() }));
@Global()
@Module({
  providers: [
    {
      provide: getDataSourceToken('agency'),
      useValue: {
        options: { type: 'postgres' },
        entityMetadatas: [],
        getRepository: () => ({}),
        manager: {},
      },
    },
  ],
  exports: [getDataSourceToken('agency')],
})
class StubAgencyDatabase {}
@Module({
  providers: [{ provide: EmailService, useValue: { sendEmail: jest.fn() } }],
  exports: [EmailService],
})
class StubEmailModule {}

describe('CA7 real Nest module wiring', () => {
  it('constructs the real module and registers its authenticator on init (not a foreign DI token)', async () => {
    const ref = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        StubAgencyDatabase,
        ClientAreaModule,
      ],
    })
      .overrideModule(EmailModule)
      .useModule(StubEmailModule)
      .compile();
    await ref.init();
    expect(ref.get(AuditChangeInterceptor)).toBeInstanceOf(
      AuditChangeInterceptor,
    );
    expect(ref.get(ClientAreaMemberAccessService)).toBeInstanceOf(
      ClientAreaMemberAccessService,
    );
    expect(ref.get(ActorDirectoryService)).toBeInstanceOf(
      ActorDirectoryService,
    );
    const handler = jest
      .spyOn(ref.get(ClientAreaBridgeAuthenticator), 'authenticate')
      .mockResolvedValue(true);
    const execution = {} as Parameters<
      ClientAreaBridgeAuthenticator['authenticate']
    >[0];
    await expect(
      ref.get(ClientAreaBridgeRegistry).authenticate(execution),
    ).resolves.toBe(true);
    expect(handler).toHaveBeenCalledWith(execution);
    jest
      .spyOn(ref.get(ActorDirectoryService), 'resolveNames')
      .mockResolvedValue({ client: 'Client (cliente)' });
    await expect(
      ref.get(ClientAreaBridgeRegistry).resolveActorNames('tenant', ['client']),
    ).resolves.toEqual({ client: 'Client (cliente)' });
    const binding = {
      tenantId: 'tenant',
      workspaceId: 'workspace',
      agencyClientId: 'client',
      userId: 'user',
      sessionId: 'session',
      companyContextId: 'company',
      module: 'social_planner' as const,
    };
    const sessionCheck = jest
      .spyOn(ref.get(ClientAreaSessionService), 'authenticate')
      .mockResolvedValue({
        tenantId: 'tenant',
        userId: 'user',
        sessionId: 'session',
        email: 'person@example.test',
      });
    const membershipCheck = jest
      .spyOn(ref.get(ClientAreaAuthorizationService), 'authorize')
      .mockResolvedValue({
        workspaceId: 'workspace',
        agencyClientId: 'client',
        role: 'client_owner',
      } as ClientAreaContext);
    const settings = ref.get(ClientAreaSettingsRegistry);
    await expect(
      settings.assertOAuthBinding(binding, {
        tenantId: 'tenant',
        companyContextId: 'company',
        userId: 'user',
      }),
    ).resolves.toBeUndefined();
    expect(sessionCheck).toHaveBeenCalledWith({
      sub: 'user',
      tenantId: 'tenant',
      sessionId: 'session',
      typ: 'client_area',
    });
    expect(membershipCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        companyContextId: 'company',
        module: 'social_planner',
      }),
    );
    membershipCheck.mockResolvedValueOnce({
      workspaceId: 'workspace',
      agencyClientId: 'client',
      role: 'client_member',
    } as ClientAreaContext);
    await expect(
      settings.assertOAuthBinding(binding, {
        tenantId: 'tenant',
        companyContextId: 'company',
      }),
    ).rejects.toThrow();
    sessionCheck.mockRejectedValueOnce(new Error('revoked session'));
    await expect(
      settings.assertOAuthBinding(binding, {
        tenantId: 'tenant',
        companyContextId: 'company',
      }),
    ).rejects.toThrow('revoked session');
    await expect(
      settings.assertOAuthBinding(binding, {
        tenantId: 'tenant',
        companyContextId: 'another-company',
      }),
    ).rejects.toThrow();
    const write = jest
      .spyOn(ref.get(AuditChangeService), 'record')
      .mockResolvedValue(undefined);
    const event = {
      tenantId: 'tenant',
      actorSurface: 'client_area' as const,
      moduleKey: 'settings',
      entityType: 'brand_kit',
      action: 'update' as const,
    };
    await settings.record(event);
    expect(write).toHaveBeenCalledWith(event);
    await ref.close();
  });
});
