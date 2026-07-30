import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAnalyticsReportDto } from './create-analytics-report.dto';

describe('CreateAnalyticsReportDto', () => {
  it('accepts the report kind and inherited operational filters', async () => {
    const dto = plainToInstance(CreateAnalyticsReportDto, {
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-22T23:00:00.000Z',
      reportType: 'automations',
      title: 'Saúde das automações',
      businessMode: 'real_estate',
    });

    await expect(
      validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
    ).resolves.toHaveLength(0);
    expect(dto.reportType).toBe('automations');
  });

  it('defaults to the overview and rejects unknown report kinds', async () => {
    const defaultDto = plainToInstance(CreateAnalyticsReportDto, {});
    expect(defaultDto.reportType).toBe('overview');

    const errors = await validate(
      plainToInstance(CreateAnalyticsReportDto, {
        reportType: 'recommendations',
        recommendationId: 'not-available-before-phase-13',
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    );

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['reportType', 'recommendationId']),
    );
  });
});
