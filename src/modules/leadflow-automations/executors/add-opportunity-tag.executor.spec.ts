import { NotFoundException } from '@nestjs/common';
import type { CrmService } from '../../crm/crm.service';
import type { CrmOpportunityFieldCatalogService } from '../../crm/services/crm-opportunity-field-catalog.service';
import { AddOpportunityTagExecutor } from './add-opportunity-tag.executor';

function build(
  overrides: {
    opportunity?: Record<string, unknown>;
    getTag?: jest.Mock;
  } = {},
) {
  const assignOpportunityTag = jest.fn().mockResolvedValue({});
  const crm = {
    getOpportunity: jest.fn().mockResolvedValue(
      overrides.opportunity ?? {
        id: 'opportunity-1',
        source: 'whatsapp',
        businessContext: {},
      },
    ),
    getTag: overrides.getTag ?? jest.fn().mockResolvedValue({ id: 'tag-1' }),
    assignOpportunityTag,
  } as unknown as CrmService;
  const fields = {
    isAddressable: jest.fn().mockReturnValue(true),
  } as unknown as CrmOpportunityFieldCatalogService;
  return {
    executor: new AddOpportunityTagExecutor(crm, fields),
    assignOpportunityTag,
  };
}

const request = (overrides: Record<string, unknown> = {}) =>
  ({
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    automationId: 'automation-1',
    correlationId: 'correlation-1',
    payload: {
      opportunityId: 'opportunity-1',
      tagIds: ['tag-1', 'tag-2'],
      ruleField: 'source',
      ruleOperator: 'equals',
      ruleValue: 'whatsapp',
      ...overrides,
    },
  }) as never;

describe('AddOpportunityTagExecutor', () => {
  it('revalidates the rule and applies each existing CRM tag idempotently', async () => {
    const { executor, assignOpportunityTag } = build();

    const result = await executor.execute(request());

    expect(result).toMatchObject({
      status: 'confirmed',
      effectConfirmed: true,
      details: { appliedTagIds: ['tag-1', 'tag-2'] },
    });
    expect(assignOpportunityTag).toHaveBeenCalledTimes(2);
    expect(assignOpportunityTag).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
      }),
      'opportunity-1',
      expect.objectContaining({
        tagId: 'tag-1',
        assignedByType: 'automation',
      }),
    );
  });

  it('does not write when current opportunity state no longer matches', async () => {
    const { executor, assignOpportunityTag } = build({
      opportunity: { id: 'opportunity-1', source: 'manual' },
    });

    const result = await executor.execute(request());

    expect(result).toMatchObject({
      status: 'refused',
      errorCode: 'tag_rule_not_matched',
    });
    expect(assignOpportunityTag).not.toHaveBeenCalled();
  });

  it('prevalidates the complete tag batch before the first assignment', async () => {
    const getTag = jest
      .fn()
      .mockResolvedValueOnce({ id: 'tag-1' })
      .mockRejectedValueOnce(new NotFoundException());
    const { executor, assignOpportunityTag } = build({ getTag });

    const result = await executor.execute(request());

    expect(result).toMatchObject({
      status: 'refused',
      errorCode: 'tag_assignment_refused',
    });
    expect(assignOpportunityTag).not.toHaveBeenCalled();
  });
});
