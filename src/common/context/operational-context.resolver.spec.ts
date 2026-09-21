import { BadRequestException } from '@nestjs/common';
import { OperationalContextResolver } from './operational-context.resolver';

function repositoryMock() {
  return { findOne: jest.fn().mockResolvedValue(null) };
}

function makeResolver() {
  const clientsRepository = repositoryMock();
  const companyContextsRepository = repositoryMock();
  const contactsRepository = repositoryMock();
  const resolver = new OperationalContextResolver(
    clientsRepository as never,
    companyContextsRepository as never,
    contactsRepository as never,
  );
  return {
    resolver,
    clientsRepository,
    companyContextsRepository,
    contactsRepository,
  };
}

const client = {
  id: 'client-a',
  tenantId: 'agency-tenant',
  workspaceId: 'workspace-a',
  managedTenantId: 'managed-tenant-a',
  displayName: 'Cliente A',
  status: 'active',
  archivedAt: null,
};

const companyContext = {
  id: 'company-context-a',
  tenantId: 'agency-tenant',
  workspaceId: 'workspace-a',
  agencyClientId: 'client-a',
  companyContactId: 'organization-a',
  status: 'active',
  archivedAt: null,
};

const companyContact = {
  id: 'organization-a',
  tenantId: 'agency-tenant',
  workspaceId: 'workspace-a',
  type: 'organization',
  status: 'active',
};

function input(headers: Record<string, string>) {
  return {
    request: { headers } as never,
    tenantId: 'agency-tenant',
    workspaceId: 'workspace-a',
  };
}

const clientHeaders = {
  'x-lyra-product-key': 'social',
  'x-lyra-operating-mode': 'client',
  'x-lyra-client-id': 'client-a',
};

describe('OperationalContextResolver company context validation', () => {
  it('accepts an active company context linked to the requested Agency Client', async () => {
    const {
      resolver,
      clientsRepository,
      companyContextsRepository,
      contactsRepository,
    } = makeResolver();
    clientsRepository.findOne.mockResolvedValue(client);
    companyContextsRepository.findOne.mockResolvedValue(companyContext);
    contactsRepository.findOne.mockResolvedValue(companyContact);

    await expect(
      resolver.resolve({
        ...input({
          ...clientHeaders,
          'x-lyra-company-context-id': 'company-context-a',
        }),
      }),
    ).resolves.toMatchObject({
      productKey: 'social',
      operatingMode: 'client',
      clientId: 'client-a',
      companyContextId: 'company-context-a',
      managedTenantId: 'managed-tenant-a',
    });
    expect(companyContextsRepository.findOne).toHaveBeenCalledWith({
      where: {
        id: 'company-context-a',
        tenantId: 'agency-tenant',
        workspaceId: 'workspace-a',
        agencyClientId: 'client-a',
      },
    });
  });

  it('allows a legacy client-only request and sets companyContextId to null', async () => {
    const { resolver, clientsRepository, companyContextsRepository } =
      makeResolver();
    clientsRepository.findOne.mockResolvedValue(client);

    await expect(resolver.resolve(input(clientHeaders))).resolves.toMatchObject(
      {
        clientId: 'client-a',
        companyContextId: null,
        managedTenantId: 'managed-tenant-a',
      },
    );
    expect(companyContextsRepository.findOne).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['other client', { ...companyContext, agencyClientId: 'client-b' }],
    ['cross-tenant', { ...companyContext, tenantId: 'tenant-b' }],
    ['cross-workspace', { ...companyContext, workspaceId: 'workspace-b' }],
    ['inactive', { ...companyContext, status: 'inactive' }],
    ['archived', { ...companyContext, status: 'archived' }],
    ['archived timestamp', { ...companyContext, archivedAt: new Date() }],
  ])(
    'rejects a %s Company Context with a non-disclosing response',
    async (_label, row) => {
      const { resolver, clientsRepository, companyContextsRepository } =
        makeResolver();
      clientsRepository.findOne.mockResolvedValue(client);
      companyContextsRepository.findOne.mockResolvedValue(row);

      await expect(
        resolver.resolve(
          input({
            ...clientHeaders,
            'x-lyra-company-context-id': 'company-context-a',
          }),
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Company context is not available for this client and workspace.',
        ),
      );
    },
  );

  it('rejects an invalid linked Contact instead of resolving the company id', async () => {
    const {
      resolver,
      clientsRepository,
      companyContextsRepository,
      contactsRepository,
    } = makeResolver();
    clientsRepository.findOne.mockResolvedValue(client);
    companyContextsRepository.findOne.mockResolvedValue(companyContext);
    contactsRepository.findOne.mockResolvedValue({
      ...companyContact,
      type: 'person',
    });

    await expect(
      resolver.resolve(
        input({
          ...clientHeaders,
          'x-lyra-company-context-id': 'company-context-a',
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a company context requested without a client id', async () => {
    const { resolver, clientsRepository } = makeResolver();

    await expect(
      resolver.resolve(
        input({
          'x-lyra-product-key': 'social',
          'x-lyra-operating-mode': 'client',
          'x-lyra-company-context-id': 'company-context-a',
        }),
      ),
    ).rejects.toThrow(/valid client context is required/i);
    expect(clientsRepository.findOne).not.toHaveBeenCalled();
  });

  it('keeps agency mode independent from Company Context selection', async () => {
    const { resolver, clientsRepository, companyContextsRepository } =
      makeResolver();

    await expect(
      resolver.resolve(
        input({
          'x-lyra-product-key': 'social',
          'x-lyra-operating-mode': 'agency',
          'x-lyra-company-context-id': 'stale-company-context',
        }),
      ),
    ).resolves.toMatchObject({
      operatingMode: 'agency',
      clientId: null,
      companyContextId: null,
    });
    expect(clientsRepository.findOne).not.toHaveBeenCalled();
    expect(companyContextsRepository.findOne).not.toHaveBeenCalled();
  });
});
