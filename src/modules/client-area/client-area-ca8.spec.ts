import { ClientAreaManagementService } from './services/client-area-management.service';
import { ConfigService } from '@nestjs/config';
import { ClientAreaPublicBrandingService } from './services/client-area-public-branding.service';
import { ClientAreaRateLimitService } from './services/client-area-rate-limit.service';
import { resolveClientAreaDomainCname } from './client-area.config';

describe('CA8 public branding and DNS', () => {
  const settings = {
    id: 's',
    tenantId: 't',
    workspaceId: 'w',
    enabled: true,
    publicSlug: 'agency-test',
    customDomain: 'clients.example.test',
    domainMode: 'custom',
    domainVerificationStatus: 'verified',
    domainVerificationToken: 'secret',
    domainVerifiedAt: new Date(),
  };
  const brand = {
    displayName: 'Agency',
    logoLightUrl: null,
    primaryColor: '#123456',
    login: { layout: 'centered' },
  };
  function setup() {
    const repo = {
      findOne: jest.fn().mockResolvedValue(settings),
      find: jest.fn().mockResolvedValue([settings]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const management = { branding: jest.fn().mockResolvedValue(brand) };
    const service = new ClientAreaPublicBrandingService(
      repo as never,
      management as never,
      new ConfigService({ CLIENT_AREA_DOMAIN_CNAME: 'agency.example.test' }),
    );
    return { repo, management, service };
  }
  it('always resolves the required CNAME destination from explicit config or the frontend URL', () => {
    expect(
      resolveClientAreaDomainCname(
        new ConfigService<Record<string | symbol, unknown>>({
          CLIENT_AREA_DOMAIN_CNAME: 'edge.example.test',
          CLIENT_AREA_FRONTEND_URL: 'https://agency.example.test/client-area',
        }),
      ),
    ).toBe('edge.example.test');
    expect(
      resolveClientAreaDomainCname(
        new ConfigService<Record<string | symbol, unknown>>({
          CLIENT_AREA_FRONTEND_URL: 'https://agency.example.test/client-area',
        }),
      ),
    ).toBe('agency.example.test');
  });
  it('resolves enabled slug and returns only branding, no settings or secret', async () => {
    const { service } = setup();
    expect(await service.resolve('agency-test', 'ignored.test')).toEqual({
      branding: brand,
    });
  });
  it('uses generic 404 for missing/disabled/invalid selectors', async () => {
    const { repo, service } = setup();
    repo.findOne.mockResolvedValueOnce(null);
    await expect(service.resolve('missing', '')).rejects.toMatchObject({
      status: 404,
    });
    repo.findOne.mockResolvedValueOnce({ ...settings, enabled: false });
    await expect(service.resolve('agency-test', '')).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      service.resolve(undefined, 'evil.test/path'),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('accepts a host only while verified and fresh', async () => {
    const { repo, service } = setup();
    expect(
      await service.resolve(undefined, 'clients.example.test:443'),
    ).toEqual({ branding: brand });
    repo.findOne.mockResolvedValueOnce({
      ...settings,
      domainVerifiedAt: new Date(0),
    });
    await expect(
      service.resolve(undefined, 'clients.example.test'),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('verifies TXT and configured CNAME; revalidation revokes a failed domain', async () => {
    const { repo, service } = setup();
    jest.spyOn(service, 'lookupTxt').mockResolvedValue([['secret']]);
    jest
      .spyOn(service, 'lookupCname')
      .mockResolvedValue(['agency.example.test.']);
    jest.spyOn(service, 'probeTls').mockResolvedValue(false);
    await expect(service.verify('t', 'w')).resolves.toMatchObject({
      status: 'verified',
      pointedBy: 'cname',
    });
    expect(await service.isAllowedOrigin('https://clients.example.test')).toBe(
      true,
    );
    expect(await service.isAllowedOrigin('http://clients.example.test')).toBe(
      false,
    );
    jest.spyOn(service, 'lookupTxt').mockRejectedValue(new Error('NXDOMAIN'));
    await service.revalidateDomains();
    expect(repo.update).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({
        domainVerificationStatus: 'failed',
        domainVerifiedAt: null,
      }),
    );
  });
  function mockDns(
    service: ClientAreaPublicBrandingService,
    records: Record<string, Record<string, string[]>>,
  ) {
    const lookup = (kind: string) => (host: string) =>
      records[kind]?.[host]
        ? Promise.resolve(records[kind][host])
        : Promise.reject(new Error('ENODATA'));
    jest.spyOn(service, 'lookupTxt').mockResolvedValue([['secret']]);
    jest.spyOn(service, 'lookupCname').mockImplementation(lookup('cname'));
    jest.spyOn(service, 'lookupA').mockImplementation(lookup('a'));
    jest.spyOn(service, 'lookupAaaa').mockImplementation(lookup('aaaa'));
  }
  it('verifies an apex domain by A records that all belong to the target', async () => {
    const { service } = setup();
    jest.spyOn(service, 'probeTls').mockResolvedValue(false);
    mockDns(service, {
      a: {
        'clients.example.test': ['82.29.61.35'],
        'agency.example.test': ['82.29.61.35'],
      },
    });
    await expect(service.verify('t', 'w')).resolves.toMatchObject({
      status: 'verified',
      pointedBy: 'a',
    });
  });
  it('refuses A records with a stray address or a foreign AAAA', async () => {
    const { service } = setup();
    mockDns(service, {
      a: {
        'clients.example.test': ['82.29.61.35', '10.0.0.9'],
        'agency.example.test': ['82.29.61.35'],
      },
    });
    await expect(service.verify('t', 'w')).resolves.toMatchObject({
      status: 'failed',
    });
    mockDns(service, {
      a: {
        'clients.example.test': ['82.29.61.35'],
        'agency.example.test': ['82.29.61.35'],
      },
      aaaa: { 'clients.example.test': ['2001:db8::1'] },
    });
    await expect(service.verify('t', 'w')).resolves.toMatchObject({
      status: 'failed',
    });
  });
  it('probes HTTPS only after the row is verified and records when it went live', async () => {
    const { repo, service } = setup();
    const order: string[] = [];
    repo.update.mockImplementation((_where: unknown, patch: object) => {
      order.push(Object.keys(patch).join(','));
      return Promise.resolve({ affected: 1 });
    });
    jest.spyOn(service, 'probeTls').mockImplementation(() => {
      order.push('probe');
      return Promise.resolve(true);
    });
    mockDns(service, {
      cname: { 'clients.example.test': ['agency.example.test'] },
    });
    await expect(service.verify('t', 'w')).resolves.toMatchObject({
      status: 'verified',
      tlsActive: true,
    });
    expect(order).toEqual([
      'domainVerificationStatus,domainVerifiedAt',
      'probe',
      'domainTlsActiveAt',
    ]);
    expect(repo.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ customDomain: 'clients.example.test' }),
      { domainTlsActiveAt: expect.any(Date) as unknown },
    );
  });
  it('clears the TLS status when the domain stops verifying', async () => {
    const { repo, service } = setup();
    jest.spyOn(service, 'lookupTxt').mockRejectedValue(new Error('NXDOMAIN'));
    await service.verify('t', 'w');
    expect(repo.update).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({
        domainVerificationStatus: 'failed',
        domainTlsActiveAt: null,
      }),
    );
  });
  it('allows on-demand TLS only from loopback, unforwarded, for a fresh verified domain', async () => {
    const { repo, service } = setup();
    expect(
      await service.isTlsAllowed('Clients.Example.Test', '127.0.0.1', false),
    ).toBe(true);
    expect(repo.findOne).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        customDomain: 'clients.example.test',
        domainVerificationStatus: 'verified',
      }) as unknown,
    });
    expect(
      await service.isTlsAllowed('clients.example.test', '127.0.0.1', true),
    ).toBe(false);
    expect(
      await service.isTlsAllowed('clients.example.test', '203.0.113.7', false),
    ).toBe(false);
    expect(await service.isTlsAllowed('a/b', '::1', false)).toBe(false);
    repo.findOne.mockResolvedValueOnce({
      ...settings,
      domainVerifiedAt: new Date(0),
    });
    expect(
      await service.isTlsAllowed('clients.example.test', '::1', false),
    ).toBe(false);
    repo.findOne.mockResolvedValueOnce(null);
    expect(
      await service.isTlsAllowed('unknown.example.test', '::1', false),
    ).toBe(false);
  });
  it('generates a named public slug without serializing internal scope IDs', async () => {
    const repo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: unknown) => value),
      upsert: jest
        .fn<Promise<unknown>, [{ publicSlug: string }, string[]]>()
        .mockResolvedValue({}),
    };
    const management = Object.create(
      ClientAreaManagementService.prototype,
    ) as ClientAreaManagementService;
    Object.assign(management, {
      settingsRepo: repo,
      companyIdentityRepo: {
        findOne: jest.fn().mockResolvedValue({ tradeName: 'Agência Ágil' }),
      },
    });
    await management.patchSettings('private-tenant', 'private-workspace', {
      enabled: true,
    });
    const saved = repo.upsert.mock.calls[0][0];
    expect(saved.publicSlug).toMatch(/^agencia-agil-[a-f0-9]{24}$/);
    expect(saved.publicSlug).not.toContain('private');
  });
  it('limits branding requests in the existing public limiter', () => {
    const limits = new ClientAreaRateLimitService();
    for (let i = 0; i < 60; i++) limits.consume({ branding_ip: 'ip' });
    expect(() => limits.consume({ branding_ip: 'ip' })).toThrow();
  });
});
