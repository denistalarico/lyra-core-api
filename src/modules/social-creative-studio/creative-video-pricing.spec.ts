import { planGenerativeReelOperations } from './creative-video-duration';
import type { VideoProviderCapabilities } from './creative-video-generation.provider';
import {
  heygenCostSnapshot,
  HEYGEN_PRICING,
  sumCosts,
  viduCostSnapshot,
  viduPricing,
  VIDU_PRICING,
} from './creative-video-pricing';

/** Vidu's audited capabilities (Q3 native ≤ 16 s, Q2 extension +1–7 s). */
const VIDU: VideoProviderCapabilities = {
  nativeMaxSeconds: 16,
  nativeMinSeconds: 3,
  extension: { minSeconds: 1, maxSeconds: 7 },
  extensionSourceMaxSeconds: 60,
  maxReferenceImages: 6,
  audio: true,
};

describe('CS4-B video duration plan', () => {
  it('15 s fits one native generation: one operation', () => {
    expect(planGenerativeReelOperations(15, VIDU)).toEqual([
      { sequence: 0, kind: 'generate', durationSeconds: 15 },
    ]);
  });

  it('16 s is still one operation (native max)', () => {
    expect(planGenerativeReelOperations(16, VIDU)).toHaveLength(1);
  });

  it('30 s = native 16 s + two native extensions of 7 s (no compositor)', () => {
    expect(planGenerativeReelOperations(30, VIDU)).toEqual([
      { sequence: 0, kind: 'generate', durationSeconds: 16 },
      { sequence: 1, kind: 'extend', durationSeconds: 7 },
      { sequence: 2, kind: 'extend', durationSeconds: 7 },
    ]);
  });

  it('splits the rest evenly with the fewest extensions', () => {
    expect(
      planGenerativeReelOperations(20, VIDU)?.map((op) => op.durationSeconds),
    ).toEqual([16, 4]);
    expect(
      planGenerativeReelOperations(25, VIDU)?.map((op) => op.durationSeconds),
    ).toEqual([16, 5, 4]);
    for (let seconds = 5; seconds <= 30; seconds += 1) {
      const plan = planGenerativeReelOperations(seconds, VIDU);
      expect(plan?.reduce((sum, op) => sum + op.durationSeconds, 0)).toBe(
        seconds,
      );
    }
  });

  it('refuses what the provider cannot do natively instead of promising it', () => {
    expect(planGenerativeReelOperations(4, VIDU)).toBeNull();
    expect(planGenerativeReelOperations(31, VIDU)).toBeNull();
    expect(planGenerativeReelOperations(12.5, VIDU)).toBeNull();
    expect(
      planGenerativeReelOperations(20, { ...VIDU, extension: null }),
    ).toBeNull();
  });
});

describe('CS4-B video pricing snapshot', () => {
  it('Vidu: provider-reported credits × versioned credit price, exact decimals', () => {
    // Q3 turbo 720p, 16 s: 12 cr/s × 16 = 192 credits (official table).
    const snapshot = viduCostSnapshot(192, viduPricing(null));
    expect(snapshot).toEqual({
      units: '192.000',
      unitKind: 'vidu_credit',
      unitPrice: '0.00500000',
      pricingVersion: VIDU_PRICING.version,
      costAmount: '0.960000',
      costCurrency: 'USD',
      costSource: 'lyra_calculated',
    });
  });

  it('a negotiated credit price gets its own pricing version', () => {
    const pricing = viduPricing('0.0043');
    expect(pricing.version).toBe('vidu.credits.override-0.0043');
    expect(viduCostSnapshot(100, pricing).costAmount).toBe('0.430000');
  });

  it('HeyGen: output seconds × (engine, avatar type) price, half-up to 6 places', () => {
    const snapshot = heygenCostSnapshot(23.4, 'avatar_iv', 'studio_avatar');
    expect(snapshot).toMatchObject({
      units: '23.400',
      unitKind: 'output_second:avatar_iv:studio_avatar',
      unitPrice: '0.06670000',
      pricingVersion: HEYGEN_PRICING.version,
      // 23.4 × 0.0667 = 1.56078
      costAmount: '1.560780',
      costSource: 'lyra_calculated',
    });
    // Seconds kept to the millisecond: 12.345 × 0.05 = 0.61725.
    expect(
      heygenCostSnapshot(12.345, 'avatar_iv', 'photo_avatar')?.costAmount,
    ).toBe('0.617250');
    // Rounded once, half-up: 1.001 × 0.0667 = 0.0667667 → 0.066767.
    expect(
      heygenCostSnapshot(1.001, 'avatar_iv', 'studio_avatar')?.costAmount,
    ).toBe('0.066767');
  });

  it('an unpriced combination has no cost (never billed at a guess)', () => {
    expect(heygenCostSnapshot(10, 'avatar_v', 'photo_avatar')).toBeNull();
    expect(heygenCostSnapshot(10, 'avatar_ix', 'studio_avatar')).toBeNull();
    expect(heygenCostSnapshot(10, 'constructor', 'studio_avatar')).toBeNull();
  });

  it('multi-operation total keeps the breakdown and sums exactly', () => {
    const operations = [
      // 30 s 720p: 192 + 50 + 50 credits at US$0.005.
      { costAmount: '0.960000', costCurrency: 'USD' },
      { costAmount: '0.250000', costCurrency: 'USD' },
      { costAmount: '0.250000', costCurrency: 'USD' },
      { costAmount: null, costCurrency: null },
    ];
    expect(sumCosts(operations)).toEqual({
      amount: '1.460000',
      currency: 'USD',
    });
    // 0.1 + 0.2 in floating point would not be 0.3.
    expect(
      sumCosts([
        { costAmount: '0.100000', costCurrency: 'USD' },
        { costAmount: '0.200000', costCurrency: 'USD' },
      ]),
    ).toEqual({ amount: '0.300000', currency: 'USD' });
    expect(sumCosts([])).toBeNull();
    expect(() =>
      sumCosts([
        { costAmount: '1.000000', costCurrency: 'USD' },
        { costAmount: '1.000000', costCurrency: 'EUR' },
      ]),
    ).toThrow();
  });
});
