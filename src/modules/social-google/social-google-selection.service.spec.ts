import { SocialGoogleSelectionService } from './social-google-selection.service';

const scope = {
  tenantId: 't',
  workspaceId: 'w',
  agencyClientId: null,
  companyContextId: null,
};

function build(properties: string[], resources: unknown[] = []) {
  const link = { status: 'connected', resources };
  const saved: unknown[] = [];
  const manager = {
    getRepository: () => ({
      findOne: async () => link,
      save: async (value: unknown) => {
        saved.push(value);
        return value;
      },
    }),
  };
  const authorizations = {
    getAccessToken: jest.fn(async () => ({
      accessToken: 'tok',
      expiresAt: null,
    })),
    withLockedAuthorization: jest.fn(
      async (_scope: unknown, work: (ctx: unknown) => unknown) =>
        work({
          manager,
          authorization: { id: 'a1' },
          audit: jest.fn(async () => undefined),
        }),
    ),
    listSelectedAdsAccounts: jest.fn(async () => []),
  };
  const google = {
    listGa4PropertySummaries: jest.fn(async () =>
      properties.map((propertyId) => ({
        propertyId,
        displayName: `P${propertyId}`,
        accountId: '1',
        accountName: 'A',
      })),
    ),
    getGa4Property: jest.fn(async () => ({
      timeZone: 'America/Sao_Paulo',
      currency: 'BRL',
    })),
    listAdsCustomers: jest.fn(async () => [
      {
        customerId: '2222222222',
        name: 'MCC',
        isManager: true,
        status: 'ENABLED',
        accessVia: 'direct',
      },
    ]),
  };
  const service = new SocialGoogleSelectionService(
    authorizations as never,
    google as never,
  );
  return { service, link, saved, authorizations };
}

describe('SocialGoogleSelectionService', () => {
  it('rejects a GA4 property that is not in the live listing', async () => {
    const { service } = build(['1']);
    await expect(
      service.selectGa4Property({ scope, userId: 'u', propertyId: '999' }),
    ).rejects.toMatchObject({ message: 'selection_invalid' });
  });

  it('rejects a manager account', async () => {
    const { service } = build([]);
    await expect(
      service.selectAdsAccount({
        scope,
        userId: 'u',
        customerId: '2222222222',
      }),
    ).rejects.toMatchObject({ message: 'selection_invalid' });
  });

  it('stores timezone and currency of a selected property', async () => {
    const { service, link } = build(['1']);
    await service.selectGa4Property({ scope, userId: 'u', propertyId: '1' });
    expect(link.resources).toEqual([
      expect.objectContaining({
        propertyId: '1',
        timeZone: 'America/Sao_Paulo',
        currency: 'BRL',
      }),
    ]);
  });

  it('refuses a sixth property', async () => {
    const existing = ['1', '2', '3', '4', '5'].map((propertyId) => ({
      propertyId,
      displayName: propertyId,
      accountId: '1',
    }));
    const { service } = build(['6'], existing);
    await expect(
      service.selectGa4Property({ scope, userId: 'u', propertyId: '6' }),
    ).rejects.toMatchObject({ message: 'selection_limit_reached' });
  });

  it('selecting an already selected property is idempotent', async () => {
    const { service, link } = build(['1']);
    await service.selectGa4Property({ scope, userId: 'u', propertyId: '1' });
    await service.selectGa4Property({ scope, userId: 'u', propertyId: '1' });
    expect(link.resources).toHaveLength(1);
  });

  it('removes a property and reports not found for an unknown one', async () => {
    const { service } = build(['1'], [{ propertyId: '1', displayName: 'x' }]);
    await expect(
      service.removeGa4Property({ scope, userId: 'u', propertyId: '2' }),
    ).rejects.toMatchObject({ message: 'selection_not_found' });
  });
});
