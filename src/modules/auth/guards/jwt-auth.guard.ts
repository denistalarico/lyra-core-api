import {
  ClientAreaBridgeRegistry,
  CLIENT_AREA_EXPOSED_METADATA,
} from '../../../common/client-area-bridge/client-area-bridge.registry';
import type { Request } from 'express';
import { Injectable, Optional, type ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    @Optional() private readonly clientAreaBridge?: ClientAreaBridgeRegistry,
  ) {
    super();
  }
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const bearer = req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    let clientToken = false;
    try {
      const payload: unknown = JSON.parse(
        Buffer.from(bearer?.split('.')[1] ?? '', 'base64url').toString(),
      );
      clientToken =
        typeof payload === 'object' &&
        payload !== null &&
        'typ' in payload &&
        payload.typ === 'client_area';
    } catch {
      /* Agency strategy handles malformed tokens as before. */
    }
    // Payload decoding only selects an authenticator. ClientAreaAuthGuard verifies the signature and session.
    if (
      clientToken &&
      Reflect.getMetadata(CLIENT_AREA_EXPOSED_METADATA, context.getHandler()) &&
      this.clientAreaBridge
    )
      return this.clientAreaBridge.authenticate(context);
    return super.canActivate(context);
  }
}
