import { AgencyClientLifecycleHooks } from './agency-client-lifecycle-hooks';

describe('AgencyClientLifecycleHooks', () => {
  const input = {
    tenantId: 'tenant',
    workspaceId: 'workspace',
    agencyClientId: 'client',
    actorUserId: null,
  };
  it('dispatches archival to the registered adapter and never dispatches restore', async () => {
    const hooks = new AgencyClientLifecycleHooks();
    const onClientArchived = jest.fn();
    const onCompanyContextArchived = jest.fn();
    hooks.register({ onClientArchived, onCompanyContextArchived });
    await hooks.onClientArchived(input);
    await hooks.onCompanyContextArchived({
      ...input,
      companyContextId: 'company',
    });
    expect(onClientArchived).toHaveBeenCalledWith(input);
    expect(onCompanyContextArchived).toHaveBeenCalledTimes(1);
    expect('onClientRestored' in hooks).toBe(false);
  });
  it('contains adapter failures so a saved archive survives and can be reconciled', async () => {
    const hooks = new AgencyClientLifecycleHooks();
    hooks.register({
      onClientArchived: jest.fn().mockRejectedValue(new Error('offline')),
      onCompanyContextArchived: jest.fn(),
    });
    await expect(hooks.onClientArchived(input)).resolves.toBeUndefined();
  });
});
