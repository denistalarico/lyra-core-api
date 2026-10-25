import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ClientAreaModule } from '../client-area/client-area.module';
import { InboxModule } from '../inbox/inbox.module';
import { LeadFlowAgentsModule } from '../leadflow-agents/leadflow-agents.module';
import { ClientAreaInboxGateway } from './client-area-inbox.gateway';
import { ClientAreaOperationsRoomGateway } from './client-area-operations-room.gateway';
import { ClientAreaBridgeRegistryModule } from '../../common/client-area-bridge/client-area-bridge.registry';
import { LeadFlowClientAreaScopeService } from './leadflow-client-area-scope.service';
import { LeadFlowClientAreaInterceptor } from './leadflow-client-area.interceptor';

@Module({
  imports: [
    ClientAreaBridgeRegistryModule,
    JwtModule.register({}),
    ClientAreaModule,
    InboxModule,
    LeadFlowAgentsModule,
  ],
  providers: [
    LeadFlowClientAreaScopeService,
    ClientAreaInboxGateway,
    ClientAreaOperationsRoomGateway,
    { provide: APP_INTERCEPTOR, useClass: LeadFlowClientAreaInterceptor },
  ],
})
export class LeadFlowClientAreaModule {}
