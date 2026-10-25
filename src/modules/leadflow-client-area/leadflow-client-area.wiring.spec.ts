import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ClientAreaBridgeRegistry } from '../../common/client-area-bridge/client-area-bridge.registry';
import { ClientAreaModule } from '../client-area/client-area.module';
import { ClientAreaSessionService } from '../client-area/services/client-area-session.service';
import { ClientAreaAuthorizationService } from '../client-area/services/client-area-authorization.service';
import type { ClientAreaContext } from '../client-area/client-area.types';
import { InboxModule } from '../inbox/inbox.module';
import { InboxRealtimeEventBusService } from '../inbox/realtime/inbox-realtime-event-bus.service';
import { LeadFlowAgentsModule } from '../leadflow-agents/leadflow-agents.module';
import { OperationsRoomEventBusService } from '../leadflow-agents/realtime/operations-room-event-bus.service';
import { LeadFlowClientAreaModule } from './leadflow-client-area.module';
import { LEADFLOW_CLIENT_AREA_ROUTES } from './leadflow-client-area.routes';

jest.mock('otplib', () => ({ verify: jest.fn() }));
const off = jest.fn();
const bus = { onEvent: jest.fn(() => off), onResync: jest.fn(() => off) };
const roomBus = {
  onEvent: jest.fn(() => off),
  onResyncRequired: jest.fn(() => off),
};
@Global()
@Module({
  providers: [
    {
      provide: getDataSourceToken('agency'),
      useValue: { query: jest.fn().mockResolvedValue([]) },
    },
  ],
  exports: [getDataSourceToken('agency')],
})
class FixtureDatabase {}
@Module({
  providers: [
    { provide: ClientAreaSessionService, useValue: {} },
    { provide: ClientAreaAuthorizationService, useValue: {} },
  ],
  exports: [ClientAreaSessionService, ClientAreaAuthorizationService],
})
class FixtureClientAuth {}
@Module({
  providers: [{ provide: InboxRealtimeEventBusService, useValue: bus }],
  exports: [InboxRealtimeEventBusService],
})
class FixtureInboxBus {}
@Module({
  providers: [{ provide: OperationsRoomEventBusService, useValue: roomBus }],
  exports: [OperationsRoomEventBusService],
})
class FixtureRoomBus {}
describe('CA11 production module init wiring', () => {
  it('registers four adapters and subscribes/unsubscribes through actual Nest lifecycle without booting products', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        FixtureDatabase,
        LeadFlowClientAreaModule,
      ],
    })
      .overrideModule(ClientAreaModule)
      .useModule(FixtureClientAuth)
      .overrideModule(InboxModule)
      .useModule(FixtureInboxBus)
      .overrideModule(LeadFlowAgentsModule)
      .useModule(FixtureRoomBus)
      .compile();
    try {
      await mod.init();
      const registry = mod.get(ClientAreaBridgeRegistry);
      const context = {
        tenantId: 'tenant',
        workspaceId: 'workspace',
        agencyClientId: 'client',
        companyContextId: 'company',
        userId: 'user',
      } as ClientAreaContext;
      for (const module of [
        'leadflow_inbox',
        'leadflow_crm',
        'leadflow_appointments',
        'leadflow_agents',
      ] as const) {
        const route = LEADFLOW_CLIENT_AREA_ROUTES.find(
          (r) =>
            r.module === module && r.method === 'GET' && !r.path.includes(':'),
        )!;
        expect(
          await registry.resolveScope(module, context, '', {
            method: route.method,
            routePath: route.path,
          }),
        ).toMatchObject({ companyContextId: 'company' });
      }
      expect(bus.onEvent).toHaveBeenCalledTimes(1);
      expect(bus.onResync).toHaveBeenCalledTimes(1);
      expect(roomBus.onEvent).toHaveBeenCalledTimes(1);
      expect(roomBus.onResyncRequired).toHaveBeenCalledTimes(1);
    } finally {
      await mod.close();
    }
    expect(off).toHaveBeenCalledTimes(4);
  });
});
