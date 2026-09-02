// Lyra Social S1.4.8 §4 — the neutral notice exists as data, seeded
// idempotently, without a migration and without ever rewriting a notice that
// recorded consents already point at.

import {
  PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
  PLATFORM_TELEMETRY_NOTICE_BODY,
  PLATFORM_TELEMETRY_NOTICE_VERSION,
  platformTelemetryNoticeContentHash,
} from '../platform-telemetry-purpose';
import { PlatformTelemetryNoticeSeedService } from './platform-telemetry-notice-seed.service';

function noticesMock() {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value: Record<string, unknown>) => ({ ...value })),
    save: jest.fn((value: Record<string, unknown>) => Promise.resolve(value)),
  };
}

describe('PlatformTelemetryNoticeSeedService', () => {
  afterEach(() => jest.clearAllMocks());

  it('creates the neutral notice when it is absent', async () => {
    const notices = noticesMock();
    const service = new PlatformTelemetryNoticeSeedService(notices as never);

    const result = await service.seed();

    expect(result).toEqual({ action: 'created' });
    expect(notices.save).toHaveBeenCalledWith(
      expect.objectContaining({
        purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
        version: PLATFORM_TELEMETRY_NOTICE_VERSION,
        locale: 'pt-BR',
        status: 'active',
        contentHash: platformTelemetryNoticeContentHash(),
      }),
    );
  });

  it('is idempotent: a second run writes nothing', async () => {
    const notices = noticesMock();
    notices.findOne.mockResolvedValue({
      id: 'existing',
      purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
      version: PLATFORM_TELEMETRY_NOTICE_VERSION,
      contentHash: platformTelemetryNoticeContentHash(),
    });
    const service = new PlatformTelemetryNoticeSeedService(notices as never);

    const result = await service.seed();

    expect(result).toEqual({ action: 'unchanged' });
    expect(notices.save).not.toHaveBeenCalled();
  });

  it('never rewrites a stored notice whose hash drifted — that would invalidate recorded consents', async () => {
    const notices = noticesMock();
    notices.findOne.mockResolvedValue({
      id: 'existing',
      purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
      version: PLATFORM_TELEMETRY_NOTICE_VERSION,
      contentHash: 'f'.repeat(64),
    });
    const service = new PlatformTelemetryNoticeSeedService(notices as never);

    const result = await service.seed();

    expect(result).toEqual({ action: 'unchanged' });
    expect(notices.save).not.toHaveBeenCalled();
  });

  it('only ever looks up and writes the neutral purpose — the legacy notice is never touched', async () => {
    const notices = noticesMock();
    const service = new PlatformTelemetryNoticeSeedService(notices as never);

    await service.seed();

    expect(notices.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
        }) as unknown,
      }),
    );

    expect(notices.save).toHaveBeenCalledWith(
      expect.objectContaining({
        purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
      }),
    );
    expect(notices.save).not.toHaveBeenCalledWith(
      expect.objectContaining({
        purposeKey: 'leadflow_product_improvement_v1',
      }),
    );
  });

  it('the neutral notice text states the platform-wide scope the legacy one did not', () => {
    expect(PLATFORM_TELEMETRY_NOTICE_BODY).toContain('Lyra Social');
    expect(PLATFORM_TELEMETRY_NOTICE_BODY).toContain('LeadFlow');
    expect(PLATFORM_TELEMETRY_NOTICE_BODY).toContain('opcional');
  });

  it('boot seeding never throws, so a missing table cannot block startup', async () => {
    const notices = noticesMock();
    notices.findOne.mockRejectedValue(new Error('relation does not exist'));
    const service = new PlatformTelemetryNoticeSeedService(notices as never);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('honours the opt-out env flag', async () => {
    const previous = process.env.PLATFORM_TELEMETRY_NOTICE_SEED_ON_BOOT;
    process.env.PLATFORM_TELEMETRY_NOTICE_SEED_ON_BOOT = 'false';
    const notices = noticesMock();
    const service = new PlatformTelemetryNoticeSeedService(notices as never);

    await service.onApplicationBootstrap();

    expect(notices.findOne).not.toHaveBeenCalled();

    if (previous === undefined) {
      delete process.env.PLATFORM_TELEMETRY_NOTICE_SEED_ON_BOOT;
    } else {
      process.env.PLATFORM_TELEMETRY_NOTICE_SEED_ON_BOOT = previous;
    }
  });
});
