import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Repository } from 'typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import type { EmailService } from '../email/email.service';
import { AgencyIdentityCredentialsService } from './agency-identity-credentials.service';
import type {
  AgencyEmailTwoFactorCodeEntity,
  AgencyUserLoginEventEntity,
  AgencyUserSecuritySettingsEntity,
} from './entities/agency-auth.entities';
import type { AgencyWorkspaceEmailSettingsEntity } from './entities/agency-settings.entities';

const VALID_CODE = '123456';

// Same contract as otplib v13: `verify` is async and resolves to `{ valid }`
// (and throws on a malformed token).
jest.mock('otplib', () => ({
  verify: jest.fn(({ token }: { token: string }) =>
    /^\d{6}$/.test(token)
      ? Promise.resolve({ valid: token === VALID_CODE })
      : Promise.reject(new Error('invalid token format')),
  ),
}));

describe('AgencyIdentityCredentialsService — authenticator 2FA', () => {
  const crypto = new SettingsCryptoService();
  const identity = { tenantId: 't', userId: 'u' };

  function service(secretEncrypted: string | null = crypto.encrypt('SECRET')) {
    const securityRepo = {
      findOne: jest.fn().mockResolvedValue({
        twoFactorSecretEncrypted: secretEncrypted,
      }),
    } as unknown as Repository<AgencyUserSecuritySettingsEntity>;

    return new AgencyIdentityCredentialsService(
      securityRepo,
      {} as Repository<AgencyEmailTwoFactorCodeEntity>,
      {} as Repository<AgencyUserLoginEventEntity>,
      {} as Repository<AgencyWorkspaceEmailSettingsEntity>,
      {} as EmailService,
      crypto,
    );
  }

  // Regression: `!verify(...)` on a Promise was always false, so Agency
  // login accepted any authenticator code.
  it('rejects a wrong or malformed code', async () => {
    const credentials = service();

    await expect(
      credentials.verifyTwoFactorCode('authenticator', identity, '000000'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      credentials.verifyTwoFactorCode('authenticator', identity, 'not-a-code'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the identity has no authenticator secret', async () => {
    await expect(
      service(null).verifyTwoFactorCode('authenticator', identity, VALID_CODE),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts the current code', async () => {
    await expect(
      service().verifyTwoFactorCode(
        'authenticator',
        identity,
        ` ${VALID_CODE} `,
      ),
    ).resolves.toBeUndefined();
  });
});

describe('AgencyIdentityCredentialsService — email 2FA attempts (SEC-02)', () => {
  const crypto = new SettingsCryptoService();
  const identity = { tenantId: 't', userId: 'u' };

  function service(attempts: number) {
    return new AgencyIdentityCredentialsService(
      {} as Repository<AgencyUserSecuritySettingsEntity>,
      {
        findOne: jest.fn(() =>
          Promise.resolve({
            codeHash: createHash('sha256').update(VALID_CODE).digest('hex'),
            usedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
            attempts,
          }),
        ),
        save: jest.fn(),
      } as unknown as Repository<AgencyEmailTwoFactorCodeEntity>,
      {} as Repository<AgencyUserLoginEventEntity>,
      {} as Repository<AgencyWorkspaceEmailSettingsEntity>,
      {} as EmailService,
      crypto,
    );
  }

  it('accepts the right code before the attempt cap', async () => {
    await expect(
      service(4).verifyTwoFactorCode('email', identity, VALID_CODE),
    ).resolves.toBeUndefined();
  });

  it('refuses even the right code once 5 wrong guesses were made', async () => {
    await expect(
      service(5).verifyTwoFactorCode('email', identity, VALID_CODE),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
