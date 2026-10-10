import {
  IMAGE_TOKEN_PRICING,
  priceImageGeneration,
  type ImageTokenPricingVersion,
} from './creative-image-pricing';

const AT = new Date('2026-10-07T12:00:00.000Z');
const MODEL = 'gpt-image-2.5-flare-2026-09-08';

describe('CS6-B image token pricing', () => {
  it('prices the production smoke generations exactly (US$, 6 places)', () => {
    // CS3.3 smoke `20dc34d1`: 18 text in, 439 image out.
    expect(
      priceImageGeneration({
        provider: 'openai',
        model: MODEL,
        occurredAt: AT,
        metrics: {
          images: 1,
          input_tokens: 18,
          input_text_tokens: 18,
          input_image_tokens: 0,
          output_tokens: 439,
          output_image_tokens: 439,
          output_text_tokens: 0,
          total_tokens: 457,
        },
      }),
    ).toEqual({
      status: 'known',
      version: 'openai.images.standard.2026-10-06',
      tier: 'standard',
      currency: 'USD',
      amount: '0.013260',
      tokens: '457',
      rates: IMAGE_TOKEN_PRICING[0].perMillionTokens,
    });
    // Variation with the base image as input: 258 text + 1024 image in.
    expect(
      priceImageGeneration({
        provider: 'openai',
        model: MODEL,
        occurredAt: AT,
        metrics: {
          input_text_tokens: 258,
          input_image_tokens: 1024,
          output_image_tokens: 439,
          total_tokens: 1721,
        },
      }),
    ).toMatchObject({ amount: '0.022652', tokens: '1721' });
  });

  it('rounds half-up once, never per metric', () => {
    const table: ImageTokenPricingVersion[] = [
      {
        ...IMAGE_TOKEN_PRICING[0],
        perMillionTokens: {
          input_text_tokens: '0.25',
          output_image_tokens: '0.25',
        },
      },
    ];
    const price = (metrics: Record<string, number>) =>
      priceImageGeneration({
        provider: 'openai',
        model: MODEL,
        occurredAt: AT,
        metrics,
        table,
      });
    // Each token is US$ 0.00000025: alone it rounds to zero…
    expect(price({ input_text_tokens: 1 })).toMatchObject({
      amount: '0.000000',
    });
    // …but two of them are 0.0000005 → half-up to 0.000001. Rounding each
    // metric first would have lost it.
    expect(
      price({ input_text_tokens: 1, output_image_tokens: 1 }),
    ).toMatchObject({
      amount: '0.000001',
    });
  });

  it('uses the version in force at the operation date, never a later one', () => {
    const table: ImageTokenPricingVersion[] = [
      { ...IMAGE_TOKEN_PRICING[0] },
      {
        ...IMAGE_TOKEN_PRICING[0],
        version: 'openai.images.standard.2026-12-01',
        effectiveFrom: '2026-12-01T00:00:00.000Z',
        perMillionTokens: {
          ...IMAGE_TOKEN_PRICING[0].perMillionTokens,
          output_image_tokens: '60.00',
        },
      },
    ];
    const metrics = { output_image_tokens: 1_000_000 };
    expect(
      priceImageGeneration({
        provider: 'openai',
        model: MODEL,
        metrics,
        occurredAt: AT,
        table,
      }),
    ).toMatchObject({
      version: 'openai.images.standard.2026-10-06',
      amount: '30.000000',
    });
    expect(
      priceImageGeneration({
        provider: 'openai',
        model: MODEL,
        metrics,
        occurredAt: new Date('2026-12-02T00:00:00.000Z'),
        table,
      }),
    ).toMatchObject({
      version: 'openai.images.standard.2026-12-01',
      amount: '60.000000',
    });
  });

  it('is unknown — never partial, never zero — without a price or usage', () => {
    const metrics = { input_text_tokens: 10, output_image_tokens: 10 };
    const unknown = (
      input: Partial<Parameters<typeof priceImageGeneration>[0]>,
    ) =>
      priceImageGeneration({
        provider: 'openai',
        model: MODEL,
        metrics,
        occurredAt: AT,
        ...input,
      });
    expect(
      unknown({ occurredAt: new Date('2026-10-05T23:59:59.000Z') }),
    ).toEqual({
      status: 'unknown',
      reason: 'unpriced',
    });
    expect(unknown({ model: 'gpt-image-2.5-sunburst' })).toMatchObject({
      reason: 'unpriced',
    });
    expect(unknown({ model: null })).toMatchObject({ reason: 'unpriced' });
    expect(unknown({ provider: 'other' })).toMatchObject({
      reason: 'unpriced',
    });
    // A billable metric with no price in the version → the whole call is unknown.
    expect(
      unknown({ metrics: { ...metrics, output_text_tokens: 5 } }),
    ).toMatchObject({
      reason: 'unpriced',
    });
    expect(unknown({ metrics: null })).toEqual({
      status: 'unknown',
      reason: 'usage_missing',
    });
    expect(unknown({ metrics: {} })).toMatchObject({ reason: 'usage_missing' });
    expect(unknown({ metrics: { input_text_tokens: 1.5 } })).toMatchObject({
      reason: 'usage_missing',
    });
  });
});
