import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TransferCrmOpportunityDto } from './transfer-crm-opportunity.dto';

describe('TransferCrmOpportunityDto', () => {
  const pipelineId = '00000000-0000-4000-8000-000000000001';
  const stageId = '00000000-0000-4000-8000-000000000002';

  it.each(['manual_pipeline_transfer', 'sales_process_reroute'])(
    'accepts the governed reason %s',
    async (reasonCode) => {
      const dto = plainToInstance(TransferCrmOpportunityDto, {
        pipelineId,
        stageId,
        expectedVersion: 7,
        reasonCode,
      });

      await expect(
        validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
      ).resolves.toHaveLength(0);
    },
  );

  it('rejects malformed targets, ungoverned reasons, and unknown fields', async () => {
    const dto = plainToInstance(TransferCrmOpportunityDto, {
      pipelineId: 'not-a-uuid',
      stageId: 'also-not-a-uuid',
      reasonCode: 'silent_reroute',
      tenantId: 'forbidden',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining([
        'pipelineId',
        'stageId',
        'reasonCode',
        'tenantId',
      ]),
    );
  });
});
