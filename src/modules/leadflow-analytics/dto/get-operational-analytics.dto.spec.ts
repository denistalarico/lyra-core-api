import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetOperationalAnalyticsDto } from './get-operational-analytics.dto';

describe('GetOperationalAnalyticsDto', () => {
  it('accepts the bounded operational filters', async () => {
    await expect(
      validate(
        plainToInstance(GetOperationalAnalyticsDto, {
          from: '2026-07-01T00:00:00.000Z',
          to: '2026-07-22T23:00:00.000Z',
          channelId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          businessMode: 'real_estate',
          agentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      ),
    ).resolves.toHaveLength(0);
  });

  it('rejects invalid dimensions and unknown query fields', async () => {
    const errors = await validate(
      plainToInstance(GetOperationalAnalyticsDto, {
        channelId: 'not-a-uuid',
        businessMode: 'invalid mode',
        pipelineId: 'unscoped-filter',
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    );

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['channelId', 'businessMode', 'pipelineId']),
    );
  });
});
