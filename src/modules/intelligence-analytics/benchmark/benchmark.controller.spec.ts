import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import type { RequestContext } from '../../../common/context/request-context.interface';
import type { PlatformPermissionService } from '../../permissions/services/platform-permission.service';
import { BenchmarkQueryDto } from '../dto/benchmark.query.dto';
import { BenchmarkController } from './benchmark.controller';
import type { BenchmarkService } from './benchmark.service';

/**
 * The endpoint's authorization and its input surface.
 *
 * The input surface is the more interesting half: what a caller *cannot* ask is
 * the differencing control, and a DTO that quietly accepted an extra field would
 * defeat it without failing anything else.
 */
describe('BenchmarkController', () => {
  const ctx = {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    role: 'owner',
  } as RequestContext;

  const query = (overrides: Partial<BenchmarkQueryDto> = {}) =>
    ({
      businessModeKey: 'agency_services',
      provider: 'meta',
      destination: 'whatsapp',
      ...overrides,
    }) as BenchmarkQueryDto;

  const build = (input: { allowed?: boolean } = {}) => {
    const getBenchmark = jest.fn().mockResolvedValue({ available: false });
    const canAccessProduct = jest.fn().mockResolvedValue(input.allowed ?? true);

    const controller = new BenchmarkController(
      { getBenchmark } as unknown as BenchmarkService,
      { canAccessProduct } as unknown as PlatformPermissionService,
    );

    return { controller, getBenchmark, canAccessProduct };
  };

  describe('authorization', () => {
    it('requires the Social product entitlement', async () => {
      const { controller, canAccessProduct } = build({ allowed: false });

      await expect(
        controller.benchmark(ctx, 'paid_impressions', query()),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(canAccessProduct).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1' }),
        'social',
      );
    });

    it('refuses an incomplete authenticated context', async () => {
      const { controller } = build();

      await expect(
        controller.benchmark(
          { ...ctx, userId: undefined } as RequestContext,
          'paid_impressions',
          query(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    /**
     * §27: the reader's permission decides reading, never contributing.
     *
     * The controller passes no consent, opt-in or contribution signal to the
     * service — a caller with Analytics permission cannot cause any tenant to
     * start contributing.
     */
    it('passes no consent or contribution signal to the service', async () => {
      const { controller, getBenchmark } = build();

      await controller.benchmark(ctx, 'paid_impressions', query());

      const [input] = getBenchmark.mock.calls[0] as [Record<string, unknown>];

      expect(Object.keys(input).sort()).toEqual([
        'cohort',
        'metricKey',
        'windowKey',
      ]);
    });

    /** The caller's own scope never reaches the benchmark query. */
    it('never forwards the caller tenant into the benchmark', async () => {
      const { controller, getBenchmark } = build();

      await controller.benchmark(ctx, 'paid_impressions', query());

      expect(JSON.stringify(getBenchmark.mock.calls[0])).not.toContain(
        'tenant-1',
      );
    });
  });

  describe('metric key', () => {
    it('rejects a metric outside the closed set', async () => {
      const { controller, getBenchmark } = build();

      await expect(
        controller.benchmark(ctx, 'revenue', query()),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(getBenchmark).not.toHaveBeenCalled();
    });

    it('rejects a Phase B metric', async () => {
      const { controller } = build();

      for (const metric of ['conversations', 'qualified_leads', 'won_value']) {
        await expect(
          controller.benchmark(ctx, metric, query()),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });
  });

  describe('window', () => {
    it('defaults to the only supported window', async () => {
      const { controller, getBenchmark } = build();

      await controller.benchmark(ctx, 'paid_impressions', query());

      expect(getBenchmark).toHaveBeenCalledWith(
        expect.objectContaining({ windowKey: 'trailing_30_completed_days_v1' }),
      );
    });
  });

  /**
   * The DTO is the privacy boundary, so it is validated directly.
   *
   * `forbidNonWhitelisted` is what turns "there is no tenant filter" into "a
   * tenant filter is rejected", and the difference matters: without it an extra
   * property is silently ignored today and silently *used* the moment someone
   * adds a field with that name.
   */
  describe('the query surface', () => {
    const check = (payload: Record<string, unknown>) =>
      validate(plainToInstance(BenchmarkQueryDto, payload), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

    it('accepts a well-formed cohort', async () => {
      expect(
        await check({
          businessModeKey: 'agency_services',
          provider: 'meta',
          destination: 'whatsapp',
          currency: 'BRL',
        }),
      ).toHaveLength(0);
    });

    it('rejects a tenant-custom business mode', async () => {
      expect(
        await check({
          businessModeKey: 'meu_modo',
          provider: 'meta',
          destination: 'whatsapp',
        }),
      ).not.toHaveLength(0);
    });

    it('rejects a destination outside the canonical set', async () => {
      expect(
        await check({
          businessModeKey: 'agency_services',
          provider: 'meta',
          destination: 'telegram',
        }),
      ).not.toHaveLength(0);
    });

    it('rejects a malformed currency', async () => {
      expect(
        await check({
          businessModeKey: 'agency_services',
          provider: 'meta',
          destination: 'whatsapp',
          currency: 'reais',
        }),
      ).not.toHaveLength(0);
    });

    /**
     * The differencing surface, closed field by field.
     *
     * Each of these is a way to narrow a cohort until it contains one
     * contributor. None may be expressible.
     */
    it.each([
      ['a tenant filter', { tenantId: 'other-tenant' }],
      ['a tenant exclusion', { excludeTenantId: 'other-tenant' }],
      ['an arbitrary start date', { since: '2026-09-01' }],
      ['an arbitrary end date', { until: '2026-09-02' }],
      ['a free grouping', { groupBy: 'campaign' }],
      ['an invented dimension', { dimensions: ['adset'] }],
      ['a contributor id', { scopePseudonym: 'abc' }],
      ['a sample override', { minSampleSize: 1 }],
    ])('rejects %s', async (_label, extra) => {
      const errors = await check({
        businessModeKey: 'agency_services',
        provider: 'meta',
        destination: 'whatsapp',
        ...extra,
      });

      expect(errors).not.toHaveLength(0);
    });

    it('rejects an unsupported window', async () => {
      expect(
        await check({
          businessModeKey: 'agency_services',
          provider: 'meta',
          destination: 'whatsapp',
          window: 'last_7_days',
        }),
      ).not.toHaveLength(0);
    });
  });
});
