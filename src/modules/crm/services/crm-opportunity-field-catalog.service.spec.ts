import type { Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import type { LeadFlowBusinessModeTemplateEntity } from '../../leadflow-settings/entities';
import { CrmOpportunityFieldCatalogService } from './crm-opportunity-field-catalog.service';

const ctx = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
} as RequestContext;

function build(template: Partial<LeadFlowBusinessModeTemplateEntity> | null) {
  const findOne = jest.fn().mockResolvedValue(template);
  const repository = {
    findOne,
  } as unknown as Repository<LeadFlowBusinessModeTemplateEntity>;
  return {
    service: new CrmOpportunityFieldCatalogService(repository),
    findOne,
  };
}

describe('CrmOpportunityFieldCatalogService', () => {
  it('returns core fields when no business mode is given', async () => {
    const { service, findOne } = build(null);

    const catalog = await service.listFields(ctx, null);

    expect(catalog.businessModeResolved).toBe(false);
    expect(catalog.fields.every((spec) => spec.origin === 'core')).toBe(true);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('still returns core fields when the mode cannot be found', async () => {
    // Refusing outright would leave the settings page unusable for a client
    // whose Business Mode was never configured.
    const { service } = build(null);

    const catalog = await service.listFields(ctx, 'real_estate');

    expect(catalog.businessModeKey).toBe('real_estate');
    expect(catalog.businessModeResolved).toBe(false);
    expect(catalog.fields.length).toBeGreaterThan(0);
  });

  it('adds the qualification fields declared by the mode', async () => {
    const { service } = build({
      qualificationFields: [
        { key: 'tipo_de_imovel', label: 'Tipo de imóvel', required: true },
      ],
    } as Partial<LeadFlowBusinessModeTemplateEntity>);

    const catalog = await service.listFields(ctx, 'real_estate');

    expect(catalog.businessModeResolved).toBe(true);
    expect(catalog.fields).toContainEqual(
      expect.objectContaining({
        key: 'businessContext.tipo_de_imovel',
        label: 'Tipo de imóvel',
        essential: true,
      }),
    );
  });

  it('prefers a tenant template over the official one', async () => {
    const { service, findOne } = build({
      qualificationFields: [],
    } as unknown as Partial<LeadFlowBusinessModeTemplateEntity>);

    await service.listFields(ctx, 'real_estate');

    const first = findOne.mock.calls[0] as [{ where: { tenantId: unknown } }];
    expect(first[0].where.tenantId).toBe('tenant-1');
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  describe('essentialFields', () => {
    it('reports non-resolution instead of an empty list that looks complete', async () => {
      // "No essential fields" and "we could not find the mode" must not read
      // the same way — the Lead Score treats them very differently.
      const { service } = build(null);

      const result = await service.essentialFields(ctx, 'real_estate');

      expect(result.resolved).toBe(false);
      expect(result.fields).toEqual([]);
    });

    it('returns only the fields the mode marked as required', async () => {
      const { service } = build({
        qualificationFields: [
          { key: 'a', label: 'Campo A', required: true },
          { key: 'b', label: 'Campo B', required: false },
        ],
      } as Partial<LeadFlowBusinessModeTemplateEntity>);

      const result = await service.essentialFields(ctx, 'real_estate');

      expect(result.resolved).toBe(true);
      expect(result.fields.map((spec) => spec.key)).toEqual([
        'businessContext.a',
      ]);
    });
  });
});
