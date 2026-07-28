import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type {
  AdminAuthTokenPayload,
  AdminTwoFactorTokenPayload,
} from '../types/admin-access.types';
import { isPlatformAdminRoleKey } from '../types/admin-access.types';

type JwtExpiration = NonNullable<
  Parameters<JwtService['signAsync']>[1]
>['expiresIn'];

const DEVELOPMENT_ACCESS_SECRET =
  'lyra_admin_development_access_secret_change_before_production';
const DEVELOPMENT_TWO_FACTOR_SECRET =
  'lyra_admin_development_2fa_secret_change_before_production';

@Injectable()
export class AdminAuthTokenService implements OnModuleInit {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    this.getAccessSecret();
    this.getTwoFactorSecret();
  }

  signAccessToken(payload: AdminAuthTokenPayload): Promise<string> {
    return this.jwtService.signAsync(payload, {
      secret: this.getAccessSecret(),
      expiresIn: (this.configService.get<string>('ADMIN_ACCESS_TOKEN_TTL') ??
        '10m') as JwtExpiration,
    });
  }

  signTwoFactorToken(payload: AdminTwoFactorTokenPayload): Promise<string> {
    return this.jwtService.signAsync(payload, {
      secret: this.getTwoFactorSecret(),
      expiresIn: '5m',
    });
  }

  async verifyAccessToken(token: string): Promise<AdminAuthTokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<AdminAuthTokenPayload>(
        token,
        { secret: this.getAccessSecret() },
      );

      if (
        payload.sessionContext !== 'admin' ||
        !payload.sub ||
        !payload.adminId ||
        !['agency', 'platform_admin'].includes(
          payload.identitySource ?? 'agency',
        ) ||
        ((payload.identitySource ?? 'agency') === 'agency'
          ? !payload.identityTenantId
          : !payload.platformAdminIdentityId) ||
        !payload.sessionId ||
        !payload.email ||
        !isPlatformAdminRoleKey(payload.roleKey)
      ) {
        throw new Error('invalid_admin_access_payload');
      }

      return payload;
    } catch {
      throw new UnauthorizedException('Invalid administrative session.');
    }
  }

  async verifyTwoFactorToken(
    token: string,
    expectedFlow?: AdminTwoFactorTokenPayload['flow'],
  ): Promise<AdminTwoFactorTokenPayload> {
    try {
      const payload =
        await this.jwtService.verifyAsync<AdminTwoFactorTokenPayload>(token, {
          secret: this.getTwoFactorSecret(),
        });

      if (
        payload.sessionContext !== 'admin-2fa' ||
        !payload.sub ||
        !payload.adminId ||
        !['agency', 'platform_admin'].includes(
          payload.identitySource ?? 'agency',
        ) ||
        ((payload.identitySource ?? 'agency') === 'agency'
          ? !payload.identityTenantId
          : !payload.platformAdminIdentityId) ||
        !payload.email ||
        !isPlatformAdminRoleKey(payload.roleKey) ||
        (expectedFlow && payload.flow !== expectedFlow)
      ) {
        throw new Error('invalid_admin_two_factor_payload');
      }

      return payload;
    } catch {
      throw new UnauthorizedException(
        'Invalid administrative verification context.',
      );
    }
  }

  getRefreshTokenTtlMs(): number {
    return parseDuration(
      this.configService.get<string>('ADMIN_REFRESH_TOKEN_TTL') ?? '7d',
      7 * 24 * 60 * 60 * 1000,
    );
  }

  private getAccessSecret(): string {
    return this.getSecret('ADMIN_JWT_ACCESS_SECRET', DEVELOPMENT_ACCESS_SECRET);
  }

  private getTwoFactorSecret(): string {
    return this.getSecret(
      'ADMIN_JWT_2FA_SECRET',
      DEVELOPMENT_TWO_FACTOR_SECRET,
    );
  }

  private getSecret(name: string, developmentFallback: string): string {
    const configured = this.configService.get<string>(name)?.trim();
    if (configured) {
      return configured;
    }

    if (this.configService.get<string>('NODE_ENV') === 'production') {
      throw new Error(`${name} is required in production`);
    }

    return developmentFallback;
  }
}

export function parseDuration(value: string, fallbackMs: number): number {
  const match = value.trim().match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) {
    return fallbackMs;
  }

  const amount = Number(match[1]);
  if (amount <= 0) {
    return fallbackMs;
  }
  const multiplier: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * multiplier[match[2]];
}
