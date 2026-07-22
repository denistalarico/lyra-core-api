import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CopyCrmOpportunityDto } from './copy-crm-opportunity.dto';
import { ReconvertCrmOpportunityDto } from './reconvert-crm-opportunity.dto';

const pipelineId = '00000000-0000-4000-8000-000000000001';
const stageId = '00000000-0000-4000-8000-000000000002';

describe('CRM opportunity lineage DTOs', () => {
  it.each([
    'distinct_negotiation',
    'parallel_sales_process',
    'commercial_expansion',
  ])('accepts the governed copy reason %s', async (reasonCode) => {
    const dto = plainToInstance(CopyCrmOpportunityDto, {
      pipelineId,
      stageId,
      title: 'Nova negociação',
      expectedVersion: 3,
      reasonCode,
    });
    await expect(
      validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
    ).resolves.toHaveLength(0);
  });

  it.each(['new_conversion', 'renewed_interest', 'new_sales_cycle'])(
    'accepts the governed reconversion reason %s',
    async (reasonCode) => {
      const dto = plainToInstance(ReconvertCrmOpportunityDto, {
        pipelineId,
        title: 'Novo ciclo',
        expectedVersion: 3,
        reasonCode,
      });
      await expect(
        validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
      ).resolves.toHaveLength(0);
    },
  );

  it('rejects arbitrary lineage, conversation, and ownership fields', async () => {
    const dto = plainToInstance(CopyCrmOpportunityDto, {
      pipelineId,
      stageId,
      reasonCode: 'silent_duplicate',
      sourceOpportunityId: '00000000-0000-4000-8000-000000000003',
      inboxConversationId: '00000000-0000-4000-8000-000000000004',
      assignedUserId: '00000000-0000-4000-8000-000000000005',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining([
        'reasonCode',
        'sourceOpportunityId',
        'inboxConversationId',
        'assignedUserId',
      ]),
    );
  });
});
