import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthTokenPayload } from '../types/auth-token-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    const secretOrKey = configService.get<string>('JWT_ACCESS_SECRET');

    if (!secretOrKey) {
      throw new Error('JWT_ACCESS_SECRET is not configured');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey,
    });
  }

  /**
   * Agency/Suite access tokens (`AuthTokenPayload`) never carry a `typ` or a
   * `type` claim. Anything that does is a different kind of token:
   *
   * - `typ: 'client_area'` (CA1) — a Client Area access token. It is signed
   *   with its own secret and should never verify here; this is defense in
   *   depth in case the secrets are ever misconfigured to the same value.
   * - `type: 'agency-2fa' | '2fa'` — the 5-minute 2FA challenge tokens. When
   *   `JWT_2FA_SECRET` is unset they are signed with `JWT_ACCESS_SECRET`, so
   *   without this check a password-only challenge token would authenticate
   *   on every `JwtAuthGuard` route and skip the second factor.
   *
   * Existing access tokens have neither claim, so no live session is affected.
   */
  validate(
    payload: AuthTokenPayload & { typ?: unknown; type?: unknown },
  ): AuthTokenPayload {
    if (payload.typ !== undefined || payload.type !== undefined) {
      throw new UnauthorizedException('Invalid access token');
    }

    return payload;
  }
}
