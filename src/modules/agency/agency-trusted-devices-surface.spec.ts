import { AgencySettingsService } from './agency-settings.service';

jest.mock('otplib', () => ({
  generateSecret: jest.fn(),
  generateURI: jest.fn(),
  verify: jest.fn(),
}));

/** CA14 D-CA14-BE-1: Agency never consumes Client Area devices. */
describe('CA14 Agency trusted-device surface isolation', () => {
  const tenantId = 'tenant';
  const userId = 'user';

  function harness() {
    const device = {
      id: 'client-device',
      tenantId,
      userId,
      surface: 'client_area',
      deviceFingerprint: 'same-browser',
      revokedAt: null as Date | null,
      trustedAt: new Date(),
    };
    const repo = {
      find: jest
        .fn<Promise<unknown[]>, [{ where: Record<string, unknown> }]>()
        .mockResolvedValue([device]),
      findOne: jest
        .fn<Promise<typeof device | null>, [{ where: { surface?: string } }]>()
        .mockImplementation(({ where }) =>
          Promise.resolve(
            where.surface === undefined || where.surface === device.surface
              ? device
              : null,
          ),
        ),
      create: jest
        .fn<unknown, [unknown]>()
        .mockImplementation((value) => value),
      save: jest
        .fn<Promise<unknown>, [unknown]>()
        .mockImplementation((value) => Promise.resolve(value)),
    };
    const service = Object.create(
      AgencySettingsService.prototype,
    ) as AgencySettingsService;
    Object.assign(service, {
      trustedDevicesRepo: repo,
      getSecurity: jest.fn().mockResolvedValue({}),
      userSessionsRepo: {
        findOne: jest.fn().mockResolvedValue({
          tenantId,
          userId,
          id: 'agency-session',
          surface: 'agency',
          deviceFingerprint: 'same-browser',
        }),
      },
    });
    return { service, repo, device };
  }

  it('list query constrains the Agency surface', async () => {
    const { service, repo } = harness();
    await (
      service as unknown as {
        getTrustedDevices: (
          tenantId: string,
          userId: string,
        ) => Promise<unknown>;
      }
    ).getTrustedDevices(tenantId, userId);
    expect(repo.find.mock.calls[0][0].where).toHaveProperty(
      'surface',
      'agency',
    );
  });

  it('Agency revoke refuses a Client Area device of the same identity', async () => {
    const { service, repo, device } = harness();
    await expect(
      service.revokeTrustedDevice(tenantId, userId, device.id),
    ).rejects.toThrow('Agency trusted device not found.');
    expect(repo.findOne.mock.calls[0][0].where).toHaveProperty(
      'surface',
      'agency',
    );
    expect(device.revokedAt).toBeNull();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('trusting the Agency browser creates an Agency device row', async () => {
    const { service, repo } = harness();
    await service.trustCurrentDevice(tenantId, userId, 'agency-session');
    expect(repo.findOne.mock.calls[0][0].where).toHaveProperty(
      'surface',
      'agency',
    );
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'agency' }),
    );
  });
});
