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
      rules: [
        {
          field: 'source',
          operator: 'equals',
          value: 'whatsapp',
          tagIds: ['tag-1', 'tag-2'],
        },
      ],
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

  it('applies each matching rule and ignores the ones that do not match', async () => {
    // The rules are independent decisions: the operator asked for a WhatsApp
    // tag and an urgency tag, and only one of them is true of this deal.
    const { executor, assignOpportunityTag } = build({
      opportunity: {
        id: 'opportunity-1',
        source: 'whatsapp',
        priority: 'normal',
      },
    });

    const result = await executor.execute(
      request({
        rules: [
          {
            field: 'source',
            operator: 'equals',
            value: 'whatsapp',
            tagIds: ['tag-whatsapp'],
          },
          {
            field: 'priority',
            operator: 'equals',
            value: 'urgent',
            tagIds: ['tag-urgente'],
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      status: 'confirmed',
      details: { appliedTagIds: ['tag-whatsapp'], evaluatedRules: 2 },
    });
    expect(assignOpportunityTag).toHaveBeenCalledTimes(1);
  });

  it('applies a tag named by two matching rules only once', async () => {
    const { executor, assignOpportunityTag } = build({
      opportunity: {
        id: 'opportunity-1',
        source: 'whatsapp',
        priority: 'high',
      },
    });

    const result = await executor.execute(
      request({
        rules: [
          {
            field: 'source',
            operator: 'contains',
            value: 'whats',
            tagIds: ['tag-1'],
          },
          {
            field: 'priority',
            operator: 'is_present',
            value: null,
            tagIds: ['tag-1', 'tag-2'],
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      status: 'confirmed',
      details: { appliedTagIds: ['tag-1', 'tag-2'] },
    });
    expect(assignOpportunityTag).toHaveBeenCalledTimes(2);
  });

  it('refuses a configuration with no usable rule', async () => {
    const { executor, assignOpportunityTag } = build();

    // A rule with no tag applies nothing, so it is not a rule at all.
    const result = await executor.execute(
      request({
        rules: [
          {
            field: 'source',
            operator: 'equals',
            value: 'whatsapp',
            tagIds: [],
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      status: 'refused',
      errorCode: 'tag_rule_unconfigured',
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
