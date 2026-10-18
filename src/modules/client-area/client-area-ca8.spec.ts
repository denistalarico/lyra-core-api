import { ClientAreaManagementService } from './services/client-area-management.service';
import { ConfigService } from '@nestjs/config';
import { ClientAreaPublicBrandingService } from './services/client-area-public-branding.service';
import { ClientAreaRateLimitService } from './services/client-area-rate-limit.service';

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
    await expect(service.verify('t', 'w')).resolves.toMatchObject({
      status: 'verified',
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
