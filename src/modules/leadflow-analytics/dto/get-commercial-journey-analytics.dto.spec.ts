import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetCommercialJourneyAnalyticsDto } from './get-commercial-journey-analytics.dto';

describe('GetCommercialJourneyAnalyticsDto', () => {
  it('accepts an ISO period and rejects unknown query fields', async () => {
    await expect(
      validate(
        plainToInstance(GetCommercialJourneyAnalyticsDto, {
          from: '2026-07-01T00:00:00.000Z',
          to: '2026-07-22T23:00:00.000Z',
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      ),
    ).resolves.toHaveLength(0);

    const errors = await validate(
      plainToInstance(GetCommercialJourneyAnalyticsDto, {
        from: 'not-a-date',
        pipelineId: 'unscoped-filter',
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    );
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['from', 'pipelineId']),
    );
  });
});
