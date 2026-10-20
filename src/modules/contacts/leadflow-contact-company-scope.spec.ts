import {
  assertLeadFlowContactCompany,
  leadFlowContactCompany,
} from './leadflow-contact-company-scope';
import type { RequestContext } from '../../common/context/request-context.interface';
import type { EntityManager } from 'typeorm';

const context = (companyContextId = 'company-a'): RequestContext => ({
  tenantId: 'tenant',
  workspaceId: 'workspace',
  userId: 'person',
  managedContext: {
    operatingMode: 'client',
    productKey: 'leadflow',
    clientId: 'client',
    companyContextId,
    managedTenantId: 'managed',
  },
});
describe('CA11 canonical LeadFlow contact company', () => {
  it('never falls back from an incomplete client context to the agency', () => {
    expect(() => leadFlowContactCompany(context(''))).toThrow();
    expect(
      leadFlowContactCompany({ tenantId: 'tenant', workspaceId: 'workspace' }),
    ).toBeNull();
  });
  it('checks the complete operational grain and returns 404 for unclassified/foreign contacts', async () => {
    const query = jest
      .fn<Promise<unknown[]>, [string, unknown[]]>()
      .mockResolvedValue([]);
    const manager = { query } as unknown as EntityManager;
    await expect(
      assertLeadFlowContactCompany(manager, context(), 'contact'),
    ).rejects.toMatchObject({ status: 404 });
    expect(query.mock.calls[0][1]).toEqual([
      'tenant',
      'workspace',
      'client',
      'company-a',
      'contact',
    ]);
    query.mockResolvedValue([{ contact_id: 'contact' }]);
    await expect(
      assertLeadFlowContactCompany(manager, context(), 'contact'),
    ).resolves.toBeUndefined();
    await assertLeadFlowContactCompany(
      manager,
      context('company-b'),
      'contact',
    );
    expect(query.mock.calls[2][1][3]).toBe('company-b');
  });
});
