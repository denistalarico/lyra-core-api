import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetLeadFlowOverviewDto } from './get-leadflow-overview.dto';

describe('GetLeadFlowOverviewDto', () => {
  it('accepts an optional ISO 8601 window', async () => {
    await expect(
      validate(
        plainToInstance(GetLeadFlowOverviewDto, {
          from: '2026-07-01T00:00:00.000Z',
          to: '2026-07-08T00:00:00.000Z',
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      ),
    ).resolves.toHaveLength(0);
  });

  it('rejects invalid dates and unknown query fields', async () => {
    const errors = await validate(
      plainToInstance(GetLeadFlowOverviewDto, {
        from: 'not-a-date',
        channelId: 'unscoped-filter',
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    );

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['from', 'channelId']),
    );
  });
});
