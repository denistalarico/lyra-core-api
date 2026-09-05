// Lyra Social S1.4.8 §4 — the neutral notice exists as data, seeded
// idempotently, without a migration and without ever rewriting a notice that
// recorded consents already point at.
//
// I6.2 adds a second version: `seed()` now writes v2, the provisional
// Anonymous Benchmark text, while `onApplicationBootstrap` also seeds v1
// (unchanged, historical) so a fresh environment still has it present. Both
// are covered here because they are now two independent idempotent writes
// rather than one.

import {
  PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
  PLATFORM_TELEMETRY_NOTICE_BODY,
  PLATFORM_TELEMETRY_NOTICE_CATEGORIES,
  PLATFORM_TELEMETRY_NOTICE_VERSION,
  PLATFORM_TELEMETRY_NOTICE_V1_BODY,
  platformTelemetryNoticeContentHash,
  platformTelemetryNoticeV1ContentHash,
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

  describe('seed() — the current version', () => {
    it('creates the current (v2, provisional) notice when it is absent', async () => {
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
          categories: [...PLATFORM_TELEMETRY_NOTICE_CATEGORIES],
        }),
      );
    });

    /**
     * The whole point of I6.2: this is not `'pending'`.
     *
     * `legal_review_status` still means exactly what it always meant —
     * `'approved'` is untouched — and `'provisional'` is the schema's new,
     * honest middle value rather than a mislabeled `'approved'`.
     */
    it('seeds v2 as provisional, never as approved', async () => {
      const notices = noticesMock();
      const service = new PlatformTelemetryNoticeSeedService(notices as never);

      await service.seed();

      const [written] = notices.save.mock.calls[0] as [
        { legalReviewStatus: string },
      ];

      expect(written.legalReviewStatus).toBe('provisional');
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

    it('the v2 text states the platform-wide scope and stays optional', () => {
      expect(PLATFORM_TELEMETRY_NOTICE_BODY).toContain('LeadFlow');
      expect(PLATFORM_TELEMETRY_NOTICE_BODY).toContain('Social');
      expect(PLATFORM_TELEMETRY_NOTICE_BODY).toContain('opcional');
    });

    /**
     * §12/I6.2: the text says it may still change and require a new
     * acceptance — the honest disclosure a provisional notice needs, since
     * legal review has not happened yet.
     */
    it('the v2 text discloses that it is provisional', () => {
      expect(PLATFORM_TELEMETRY_NOTICE_BODY).toMatch(/provisório/i);
    });
  });

  describe('onApplicationBootstrap() — both versions', () => {
    it('seeds v1 (unchanged, historical) alongside the current version', async () => {
      const notices = noticesMock();
      const service = new PlatformTelemetryNoticeSeedService(notices as never);

      await service.onApplicationBootstrap();

      expect(notices.save).toHaveBeenCalledWith(
        expect.objectContaining({
          version: 1,
          contentHash: platformTelemetryNoticeV1ContentHash(),
          legalReviewStatus: 'pending',
        }),
      );
      expect(notices.save).toHaveBeenCalledWith(
        expect.objectContaining({
          version: PLATFORM_TELEMETRY_NOTICE_VERSION,
          contentHash: platformTelemetryNoticeContentHash(),
          legalReviewStatus: 'provisional',
        }),
      );
    });

    /** D-4: v1's stored body is never touched, even though it is no longer current. */
    it('never rewrites v1 even when a v2+ row already exists', async () => {
      const notices = noticesMock();
      notices.findOne.mockImplementation(
        ({ where }: { where: { version: number } }) =>
          Promise.resolve(
            where.version === 1
              ? {
                  id: 'v1',
                  version: 1,
                  contentHash: platformTelemetryNoticeV1ContentHash(),
                }
              : null,
          ),
      );
      const service = new PlatformTelemetryNoticeSeedService(notices as never);

      await service.onApplicationBootstrap();

      expect(notices.save).not.toHaveBeenCalledWith(
        expect.objectContaining({ version: 1 }),
      );
      expect(notices.save).toHaveBeenCalledWith(
        expect.objectContaining({ version: PLATFORM_TELEMETRY_NOTICE_VERSION }),
      );
    });

    it('v1 keeps its original, unmodified body regardless of the current version', () => {
      expect(PLATFORM_TELEMETRY_NOTICE_V1_BODY).toContain(
        'requer revisão jurídica antes do rollout de produção',
      );
    });
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
