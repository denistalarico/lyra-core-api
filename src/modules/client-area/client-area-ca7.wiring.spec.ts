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
    await ref.close();
  });
});
