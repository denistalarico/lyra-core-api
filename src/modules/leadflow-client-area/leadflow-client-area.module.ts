import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ClientAreaModule } from '../client-area/client-area.module';
import { InboxModule } from '../inbox/inbox.module';
import { ClientAreaInboxGateway } from './client-area-inbox.gateway';
import { ClientAreaBridgeRegistryModule } from '../../common/client-area-bridge/client-area-bridge.registry';
import { LeadFlowClientAreaScopeService } from './leadflow-client-area-scope.service';
import { LeadFlowClientAreaInterceptor } from './leadflow-client-area.interceptor';

@Module({
  imports: [
    ClientAreaBridgeRegistryModule,
    JwtModule.register({}),
    ClientAreaModule,
    InboxModule,
  ],
  providers: [
    LeadFlowClientAreaScopeService,
    ClientAreaInboxGateway,
    { provide: APP_INTERCEPTOR, useClass: LeadFlowClientAreaInterceptor },
  ],
})
export class LeadFlowClientAreaModule {}
