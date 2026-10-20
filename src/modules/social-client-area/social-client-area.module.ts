import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ClientAreaBridgeRegistryModule } from '../../common/client-area-bridge/client-area-bridge.registry';
import { SocialClientAreaScopeService } from './social-client-area-scope.service';
import { SocialClientAreaInterceptor } from './social-client-area.interceptor';

/**
 * CA10 — Social on the Client Area Surface Bridge. Owns the Social scope
 * adapter (registered on the shared registry at init, D-09) and the response
 * projection; the Social product modules only carry `@ClientAreaExposed`.
 */
@Module({
  imports: [ClientAreaBridgeRegistryModule],
  providers: [
    SocialClientAreaScopeService,
    { provide: APP_INTERCEPTOR, useClass: SocialClientAreaInterceptor },
  ],
})
export class SocialClientAreaModule {}
