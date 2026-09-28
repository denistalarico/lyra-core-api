import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Request } from 'express';
import { getPermissionDefinition } from '../permissions/catalog/permission-keys.catalog';
import { PERMISSION_FUNCTIONAL_GROUPS } from '../permissions/catalog/permission-groups.catalog';
import { DEFAULT_ROLE_PERMISSION_MATRIX } from '../permissions/catalog/role-permission-matrix.catalog';
import { PlatformRoleKey } from '../permissions/enums/permission.enums';
import { CLIENT_AREA_MEMBERS_MANAGE_PERMISSION } from './agency/client-area-members.agency.controller';
import { assertClientAreaPasswordPolicy } from './client-area-password.policy';
import {
  CLIENT_AREA_INVITATION_TWO_FACTOR_TOKEN_TYPE,
  CLIENT_AREA_TOKEN_TYPE,
  CLIENT_AREA_TWO_FACTOR_TOKEN_TYPE,
  normalizeClientAreaEmail,
} from './client-area.types';
import {
  AcceptClientAreaInvitationDto,
  ChangeClientAreaMemberRoleDto,
  CreateClientAreaInvitationDto,
} from './dto/client-area.dto';
import {
  buildClientAreaInvitationUrl,
  buildClientAreaResetUrl,
  escapeHtml,
  renderClientAreaInvitationEmail,
  renderClientAreaResetEmail,
} from './services/client-area-email.service';
import {
  CLIENT_AREA_RATE_LIMIT_RULES,
  ClientAreaRateLimitService,
  clientAreaRateLimitIp,
} from './services/client-area-rate-limit.service';

// otplib is ESM-only; the credentials service imports it transitively.
jest.mock('otplib', () => ({ verify: jest.fn() }));

const TOKEN = 'a'.repeat(64);

async function errorsOf<T extends object>(cls: new () => T, body: object) {
  const errors = await validate(plainToInstance(cls, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe('CA2 rate limiter', () => {
  it('throttles per rule and discriminator with a coded 429', () => {
    const limiter = new ClientAreaRateLimitService();
    const { limit } = CLIENT_AREA_RATE_LIMIT_RULES.login_account;

    for (let attempt = 0; attempt < limit; attempt += 1) {
      limiter.consume({ login_account: 'ip:a@x.com' });
    }
    expect(() => limiter.consume({ login_account: 'ip:a@x.com' })).toThrow(
      HttpException,
    );
    try {
      limiter.consume({ login_account: 'ip:a@x.com' });
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'client_area_rate_limited',
      });
    }
    // Another account from the same origin, or the same rule name for a
    // different rule, is its own bucket.
    expect(() =>
      limiter.consume({ login_account: 'ip:b@x.com' }),
    ).not.toThrow();
    expect(() => limiter.consume({ login_email: 'ip:a@x.com' })).not.toThrow();

    limiter.reset();
    expect(() =>
      limiter.consume({ login_account: 'ip:a@x.com' }),
    ).not.toThrow();
  });

  it('spends every named bucket even when one is exhausted', () => {
    const limiter = new ClientAreaRateLimitService();
    const { limit } = CLIENT_AREA_RATE_LIMIT_RULES.password_forgot_email;
    for (let attempt = 0; attempt < limit; attempt += 1) {
      limiter.consume({ password_forgot_email: 'e' });
    }
    expect(() =>
      limiter.consume({ password_forgot_ip: 'ip', password_forgot_email: 'e' }),
    ).toThrow(HttpException);
  });

  it('keys by the proxy-set X-Real-IP, never by the client-supplied X-Forwarded-For', () => {
    const req = (headers: Record<string, string>, remote = '127.0.0.1') =>
      ({ headers, socket: { remoteAddress: remote } }) as unknown as Request;

    expect(
      clientAreaRateLimitIp(
        req({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' }),
      ),
    ).toBe('203.0.113.7');
    expect(clientAreaRateLimitIp(req({ 'x-forwarded-for': '1.1.1.1' }))).toBe(
      '127.0.0.1',
    );
    expect(clientAreaRateLimitIp(req({}, '::ffff:10.0.0.5'))).toBe('10.0.0.5');
  });
});

describe('CA2 password policy', () => {
  const email = 'pessoa@cliente.com';

  it('accepts a long enough password that matches its confirmation', () => {
    expect(
      assertClientAreaPasswordPolicy({
        password: 'uma senha longa',
        confirmation: 'uma senha longa',
        email,
      }),
    ).toBe('uma senha longa');
  });

  it.each([
    ['too short', 'curta1234', 'curta1234'],
    ['blank padding', '          ', '          '],
    ['mismatch', 'uma senha longa', 'uma senha longa!'],
    ['equal to the email', 'Pessoa@Cliente.com', 'Pessoa@Cliente.com'],
    ['too long', 'x'.repeat(129), 'x'.repeat(129)],
    ['not a string', 12345678901, 12345678901],
  ])('refuses %s with a coded 400', (_label, password, confirmation) => {
    try {
      assertClientAreaPasswordPolicy({ password, confirmation, email });
      throw new Error('accepted');
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(400);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'client_area_password_policy',
      });
    }
  });
});

describe('CA2 emails', () => {
  it('escape the company name and point at Client Area routes only', () => {
    const url = buildClientAreaInvitationUrl('https://app.test', TOKEN);
    expect(url).toBe(`https://app.test/client-area/invitations/${TOKEN}`);
    expect(buildClientAreaResetUrl('https://app.test', TOKEN)).toBe(
      `https://app.test/client-area/reset-password?token=${TOKEN}`,
    );

    const invitation = renderClientAreaInvitationEmail({
      companyDisplayName: 'XP <script>alert(1)</script> & Cia',
      role: 'client_viewer',
      url,
      expiresAt: new Date('2026-10-05T12:00:00Z'),
      productName: 'Área do Cliente',
    });
    expect(invitation.html).toContain(
      'XP &lt;script&gt;alert(1)&lt;/script&gt; &amp; Cia',
    );
    expect(invitation.html).not.toContain('<script>');
    expect(invitation.html).toContain('Visualizador');
    expect(invitation.html).toContain(url);
    expect(invitation.html).not.toMatch(/\/login["?]/);

    const reset = renderClientAreaResetEmail({
      url: buildClientAreaResetUrl('https://app.test', TOKEN),
      ttlMinutes: 30,
      productName: 'Área do Cliente',
    });
    expect(reset.html).toContain('/client-area/reset-password?token=');
    expect(reset.html).toContain('30 minutos');
  });

  it('escapeHtml covers the five HTML metacharacters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('CA2 request contracts', () => {
  it('an acceptance body cannot carry company, role, email or tenant', async () => {
    const base = { token: TOKEN, mode: 'signup' };
    expect(await errorsOf(AcceptClientAreaInvitationDto, base)).toEqual([]);
    for (const tampered of [
      { role: 'client_admin' },
      { companyContextId: 'x' },
      { email: 'outra@x.com' },
      { tenantId: 'x' },
      { agencyClientId: 'x' },
    ]) {
      expect(
        await errorsOf(AcceptClientAreaInvitationDto, {
          ...base,
          ...tampered,
        }),
      ).toEqual(Object.keys(tampered));
    }
    expect(
      await errorsOf(AcceptClientAreaInvitationDto, {
        ...base,
        token: 'short',
      }),
    ).toEqual(['token']);
  });

  it('only Client Area roles are accepted by the Agency routes', async () => {
    for (const role of ['admin', 'owner', 'manager', 'member', 'client']) {
      expect(
        await errorsOf(CreateClientAreaInvitationDto, {
          email: 'a@b.com',
          role,
        }),
      ).toEqual(['role']);
      expect(await errorsOf(ChangeClientAreaMemberRoleDto, { role })).toEqual([
        'role',
      ]);
    }
    expect(
      await errorsOf(CreateClientAreaInvitationDto, {
        email: 'a@b.com',
        role: 'client_operator',
      }),
    ).toEqual([]);
  });

  it('normalizes emails by trim + lowercase', () => {
    expect(normalizeClientAreaEmail('  Pessoa@Cliente.COM ')).toBe(
      'pessoa@cliente.com',
    );
    expect(normalizeClientAreaEmail(undefined)).toBe('');
  });

  it('the invitation 2FA token type is distinct from access and login 2FA', () => {
    expect(
      new Set([
        CLIENT_AREA_TOKEN_TYPE,
        CLIENT_AREA_TWO_FACTOR_TOKEN_TYPE,
        CLIENT_AREA_INVITATION_TWO_FACTOR_TOKEN_TYPE,
      ]).size,
    ).toBe(3);
  });
});

describe('CA2 Agency permission', () => {
  it('is an Admin+ Agency key in the clients group, not a Client Area key', () => {
    const definition = getPermissionDefinition(
      CLIENT_AREA_MEMBERS_MANAGE_PERMISSION,
    );
    expect(definition).toMatchObject({
      productKey: 'agency',
      moduleKey: 'clients',
      scopeKey: 'admin',
    });
    expect(DEFAULT_ROLE_PERMISSION_MATRIX[PlatformRoleKey.Admin]).toContain(
      CLIENT_AREA_MEMBERS_MANAGE_PERMISSION,
    );
    for (const role of [PlatformRoleKey.Manager, PlatformRoleKey.Member]) {
      expect(DEFAULT_ROLE_PERMISSION_MATRIX[role]).not.toContain(
        CLIENT_AREA_MEMBERS_MANAGE_PERMISSION,
      );
    }
    const group = PERMISSION_FUNCTIONAL_GROUPS.find(
      (entry) => entry.key === 'clients',
    );
    expect(group?.permissionKeys).toContain(
      CLIENT_AREA_MEMBERS_MANAGE_PERMISSION,
    );
    expect(
      CLIENT_AREA_MEMBERS_MANAGE_PERMISSION.startsWith('client_area.'),
    ).toBe(false);
  });
});
