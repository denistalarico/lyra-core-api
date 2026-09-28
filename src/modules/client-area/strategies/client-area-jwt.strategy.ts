import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { resolveClientAreaAccessSecret } from '../client-area.config';
import {
  CLIENT_AREA_ERROR_CODES,
  CLIENT_AREA_TOKEN_TYPE,
  isUuid,
  type ClientAreaTokenPayload,
} from '../client-area.types';

export const CLIENT_AREA_JWT_STRATEGY = 'client-area-jwt';

function sessionInvalid() {
  return new UnauthorizedException({
    statusCode: 401,
    error: 'Unauthorized',
    message: 'Invalid Client Area session.',
    code: CLIENT_AREA_ERROR_CODES.sessionInvalid,
  });
}

/**
 * Verifies Client Area access tokens only.
 *
 * - Signed with `JWT_CLIENT_AREA_ACCESS_SECRET` exclusively — the secret is
 *   read per verification, so a missing/invalid secret rejects every token
 *   instead of crashing the whole API at boot (the surface is optional).
 * - Requires `typ='client_area'`: an Agency access token (no `typ`) or a
 *   Client Area 2FA challenge token (`typ='client_area_2fa'`) never passes.
 *
 * Signature and expiry are necessary but not sufficient: `ClientAreaAuthGuard`
 * checks the live session row on every request.
 */
@Injectable()
export class ClientAreaJwtStrategy extends PassportStrategy(
  Strategy,
  CLIENT_AREA_JWT_STRATEGY,
) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['HS256'],
      secretOrKeyProvider: (
        _request: unknown,
        _rawJwtToken: unknown,
        done: (error: unknown, secret?: string) => void,
      ) => {
        const secret = resolveClientAreaAccessSecret(configService);

        if (!secret) {
          done(sessionInvalid());
          return;
        }

        done(null, secret);
      },
    });
  }

  validate(payload: Partial<ClientAreaTokenPayload>): ClientAreaTokenPayload {
    if (
      payload.typ !== CLIENT_AREA_TOKEN_TYPE ||
      !isUuid(payload.sub) ||
      !isUuid(payload.tenantId) ||
      !isUuid(payload.sessionId)
    ) {
      throw sessionInvalid();
    }

    return {
      sub: payload.sub,
      tenantId: payload.tenantId,
      sessionId: payload.sessionId,
      typ: CLIENT_AREA_TOKEN_TYPE,
      email: typeof payload.email === 'string' ? payload.email : undefined,
    };
  }
}

export { sessionInvalid as clientAreaSessionInvalidError };
