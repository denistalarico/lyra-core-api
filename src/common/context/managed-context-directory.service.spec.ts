import { ProductEntitlementStatus } from '../../modules/platform/enums/platform-product.enums';
import { ManagedContextDirectoryService } from './managed-context-directory.service';
import {
  readRequestedManagedContext,
  type RequestedManagedContext,
} from './managed-context.contract';

function createRepositoryMock() {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
  };
}

function createDirectory() {
  const clientsRepository = createRepositoryMock();
  const companyContextsRepository = createRepositoryMock();
  const contactsRepository = createRepositoryMock();
  const entitlementsRepository = createRepositoryMock();
  const clientAccessRepository = createRepositoryMock();
  const clientProductAccessRepository = createRepositoryMock();

  const directory = new ManagedContextDirectoryService(
    clientsRepository as never,
    companyContextsRepository as never,
    contactsRepository as never,
    entitlementsRepository as never,
    clientAccessRepository as never,
    clientProductAccessRepository as never,
  );

  return {
    directory,
    clientsRepository,
    companyContextsRepository,
    contactsRepository,
    entitlementsRepository,
    clientAccessRepository,
    clientProductAccessRepository,
  };
}

const member = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  role: 'member',
};

const owner = { ...member, role: 'owner' };

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    id: 'client-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    managedTenantId: 'managed-tenant-1',
    displayName: 'Empresa A',
    status: 'active',
    archivedAt: null,
    metadata: {},
    ...overrides,
  };
}

function makeEntitlement(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'managed-tenant-1',
    productKey: 'leadflow',
    status: ProductEntitlementStatus.Active,
    planKey: null,
    source: 'manual',
    startsAt: null,
    endsAt: null,
    trialEndsAt: null,
    ...overrides,
  };
}

function makeCompanyContext(overrides: Record<string, unknown> = {}) {
  return {
    id: 'company-context-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    agencyClientId: 'client-1',
    companyContactId: 'company-contact-1',
    status: 'active',
    isPrimary: false,
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeCompanyContact(overrides: Record<string, unknown> = {}) {
  return {
    id: 'company-contact-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    type: 'organization',
    displayName: 'Instituto XP',
    legalName: 'Instituto XP Ltda.',
    status: 'active',
    ...overrides,
  };
}

function requested(
  overrides: Partial<RequestedManagedContext> = {},
): RequestedManagedContext {
  return {
    productKey: 'leadflow',
    operatingMode: 'client',
    clientId: 'client-1',
    companyContextId: null,
    ...overrides,
  };
}

describe('readRequestedManagedContext', () => {
  it('reads the canonical headers', () => {
    expect(
      readRequestedManagedContext({
        'x-lyra-product-key': 'social',
        'x-lyra-operating-mode': 'client',
        'x-lyra-client-id': 'client-9',
        'x-lyra-company-context-id': 'company-9',
      }),
    ).toEqual({
      productKey: 'social',
      operatingMode: 'client',
      clientId: 'client-9',
      companyContextId: 'company-9',
    });
  });

  it('infers leadflow from the legacy operating-mode header', () => {
    expect(
      readRequestedManagedContext({
        'x-leadflow-operating-mode': 'client',
        'x-client-id': 'client-9',
      }),
    ).toEqual({
      productKey: 'leadflow',
      operatingMode: 'client',
      clientId: 'client-9',
      companyContextId: null,
    });
  });

  it('drops invalid header values instead of throwing', () => {
    expect(
      readRequestedManagedContext({
        'x-lyra-product-key': 'finance',
        'x-lyra-operating-mode': 'everything',
        'x-lyra-client-id': '   ',
      }),
    ).toEqual({
      productKey: null,
      operatingMode: null,
      clientId: null,
      companyContextId: null,
    });
  });

  it('returns an empty request when no context headers are sent', () => {
    expect(readRequestedManagedContext({})).toEqual({
      productKey: null,
      operatingMode: null,
      clientId: null,
      companyContextId: null,
    });
  });
});

describe('ManagedContextDirectoryService.listAuthorizedClients', () => {
  it('keeps an authorized Agency Client with no active companies once', async () => {
    const { directory, clientsRepository, entitlementsRepository } =
      createDirectory();
    clientsRepository.find.mockResolvedValue([makeClient()]);
    entitlementsRepository.find.mockResolvedValue([makeEntitlement()]);

    const clients = await directory.listAuthorizedClients(owner, 'leadflow');

    expect(clients).toHaveLength(1);
    expect(clients[0].companies).toEqual([]);
  });

  it('groups active companies under one authorized Agency Client using Contact names', async () => {
    const {
      directory,
      clientsRepository,
      companyContextsRepository,
      contactsRepository,
      entitlementsRepository,
    } = createDirectory();
    clientsRepository.find.mockResolvedValue([makeClient()]);
    entitlementsRepository.find.mockResolvedValue([makeEntitlement()]);
    companyContextsRepository.find.mockResolvedValue([
      makeCompanyContext({ id: 'company-context-primary', isPrimary: true }),
      makeCompanyContext({
        id: 'company-context-secondary',
        companyContactId: 'company-contact-2',
      }),
      makeCompanyContext({ id: 'inactive-context', status: 'inactive' }),
      makeCompanyContext({ id: 'archived-context', status: 'archived' }),
      makeCompanyContext({ id: 'archived-at-context', archivedAt: new Date() }),
      makeCompanyContext({ id: 'wrong-tenant', tenantId: 'tenant-other' }),
      makeCompanyContext({
        id: 'wrong-workspace',
        workspaceId: 'workspace-other',
      }),
    ]);
    contactsRepository.find.mockResolvedValue([
      makeCompanyContact(),
      makeCompanyContact({
        id: 'company-contact-2',
        displayName: 'Clínica XP',
        legalName: 'Clínica XP S.A.',
      }),
      makeCompanyContact({ id: 'wrong-type', type: 'person' }),
      makeCompanyContact({ id: 'archived-contact', status: 'archived' }),
    ]);

    const clients = await directory.listAuthorizedClients(owner, 'leadflow');

    expect(clients).toHaveLength(1);
    expect(clients[0].clientId).toBe('client-1');
    expect(clients[0].companies).toEqual([
      {
        companyContextId: 'company-context-primary',
        companyContactId: 'company-contact-1',
        displayName: 'Instituto XP',
        legalName: 'Instituto XP Ltda.',
        isPrimary: true,
      },
      {
        companyContextId: 'company-context-secondary',
        companyContactId: 'company-contact-2',
        displayName: 'Clínica XP',
        legalName: 'Clínica XP S.A.',
        isPrimary: false,
      },
    ]);
    expect(companyContextsRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          status: 'active',
          archivedAt: expect.anything(),
        }),
      }),
    );
  });

  it('returns every company the person is granted, not just one', async () => {
    const {
      directory,
      clientsRepository,
      entitlementsRepository,
      clientAccessRepository,
      clientProductAccessRepository,
    } = createDirectory();

    const clientA = makeClient();
    const clientB = makeClient({
      id: 'client-2',
      managedTenantId: 'managed-tenant-2',
      displayName: 'Empresa B',
    });

    clientsRepository.find.mockResolvedValue([clientB, clientA]);
    entitlementsRepository.find.mockResolvedValue([
      makeEntitlement(),
      makeEntitlement({ tenantId: 'managed-tenant-2' }),
    ]);
    clientAccessRepository.find.mockResolvedValue([
      { clientId: 'client-1', managedTenantId: 'managed-tenant-1' },
      { clientId: 'client-2', managedTenantId: 'managed-tenant-2' },
    ]);
    clientProductAccessRepository.find.mockResolvedValue([
      { clientId: 'client-1', managedTenantId: 'managed-tenant-1' },
      { clientId: 'client-2', managedTenantId: 'managed-tenant-2' },
    ]);

    const entries = await directory.listAuthorizedClients(member, 'leadflow');

    expect(entries.map((entry) => entry.clientId)).toEqual([
      'client-1',
      'client-2',
    ]);
  });

  it('omits a company whose client grant was revoked', async () => {
    const {
      directory,
      clientsRepository,
      entitlementsRepository,
      clientAccessRepository,
      clientProductAccessRepository,
    } = createDirectory();

    clientsRepository.find.mockResolvedValue([
      makeClient(),
      makeClient({
        id: 'client-2',
        managedTenantId: 'managed-tenant-2',
        displayName: 'Empresa B',
      }),
    ]);
    entitlementsRepository.find.mockResolvedValue([
      makeEntitlement(),
      makeEntitlement({ tenantId: 'managed-tenant-2' }),
    ]);
    clientAccessRepository.find.mockResolvedValue([
      { clientId: 'client-1', managedTenantId: 'managed-tenant-1' },
    ]);
    clientProductAccessRepository.find.mockResolvedValue([
      { clientId: 'client-1', managedTenantId: 'managed-tenant-1' },
      { clientId: 'client-2', managedTenantId: 'managed-tenant-2' },
    ]);

    const entries = await directory.listAuthorizedClients(member, 'leadflow');

    expect(entries.map((entry) => entry.clientId)).toEqual(['client-1']);
  });

  it('scopes the query to the active workspace', async () => {
    const { directory, clientsRepository } = createDirectory();

    await directory.listAuthorizedClients(
      { ...member, workspaceId: 'workspace-2' },
      'leadflow',
    );

    expect(clientsRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          workspaceId: 'workspace-2',
        }),
      }),
    );
  });

  it('returns nothing when the session has no workspace', async () => {
    const { directory, clientsRepository } = createDirectory();

    await expect(
      directory.listAuthorizedClients(
        { ...member, workspaceId: null },
        'leadflow',
      ),
    ).resolves.toEqual([]);
    expect(clientsRepository.find).not.toHaveBeenCalled();
  });

  it('never lists a product that has no managed scope', async () => {
    const { directory, clientsRepository } = createDirectory();

    await expect(
      directory.listAuthorizedClients(member, 'agency'),
    ).resolves.toEqual([]);
    expect(clientsRepository.find).not.toHaveBeenCalled();
  });

  // S1.4.6 validation: `available.social.clients` is exactly this method's
  // output for productKey 'social'. These cases were previously proven only
  // by reading `isActiveEntitlement` — never exercised by a test, and never
  // exercised with productKey 'social' specifically.
  describe('entitlement status filtering for productKey "social"', () => {
    function setupSingleClient(entitlementOverrides: Record<string, unknown>) {
      const { directory, clientsRepository, entitlementsRepository } =
        createDirectory();

      clientsRepository.find.mockResolvedValue([makeClient()]);
      entitlementsRepository.find.mockResolvedValue([
        makeEntitlement({ productKey: 'social', ...entitlementOverrides }),
      ]);

      return { directory };
    }

    it('client A: Social active entitlement appears', async () => {
      const { directory } = setupSingleClient({
        status: ProductEntitlementStatus.Active,
      });

      const entries = await directory.listAuthorizedClients(owner, 'social');

      expect(entries.map((entry) => entry.clientId)).toEqual(['client-1']);
    });

    it('client B: Social trial entitlement still within trialEndsAt appears', async () => {
      const trialEndsAt = new Date(Date.now() + 86_400_000);
      const { directory } = setupSingleClient({
        status: ProductEntitlementStatus.Trial,
        trialEndsAt,
      });

      const entries = await directory.listAuthorizedClients(owner, 'social');

      expect(entries.map((entry) => entry.clientId)).toEqual(['client-1']);
    });

    it('a Social trial entitlement past trialEndsAt does not appear', async () => {
      const trialEndsAt = new Date(Date.now() - 86_400_000);
      const { directory } = setupSingleClient({
        status: ProductEntitlementStatus.Trial,
        trialEndsAt,
      });

      await expect(
        directory.listAuthorizedClients(owner, 'social'),
      ).resolves.toEqual([]);
    });

    it('client C: Social suspended entitlement does not appear', async () => {
      const { directory } = setupSingleClient({
        status: ProductEntitlementStatus.Suspended,
      });

      await expect(
        directory.listAuthorizedClients(owner, 'social'),
      ).resolves.toEqual([]);
    });

    it('client D: Social expired entitlement does not appear', async () => {
      const { directory } = setupSingleClient({
        status: ProductEntitlementStatus.Expired,
      });

      await expect(
        directory.listAuthorizedClients(owner, 'social'),
      ).resolves.toEqual([]);
    });

    it('client E: Social cancelled entitlement does not appear', async () => {
      const { directory } = setupSingleClient({
        status: ProductEntitlementStatus.Cancelled,
      });

      await expect(
        directory.listAuthorizedClients(owner, 'social'),
      ).resolves.toEqual([]);
    });

    it('an active entitlement whose endsAt already passed does not appear', async () => {
      const { directory } = setupSingleClient({
        status: ProductEntitlementStatus.Active,
        endsAt: new Date(Date.now() - 86_400_000),
      });

      await expect(
        directory.listAuthorizedClients(owner, 'social'),
      ).resolves.toEqual([]);
    });

    it('an active entitlement whose startsAt is in the future does not appear yet', async () => {
      const { directory } = setupSingleClient({
        status: ProductEntitlementStatus.Active,
        startsAt: new Date(Date.now() + 86_400_000),
      });

      await expect(
        directory.listAuthorizedClients(owner, 'social'),
      ).resolves.toEqual([]);
    });

    it('client F: a client with only a LeadFlow entitlement row does not appear for productKey social', async () => {
      const { directory, clientsRepository, entitlementsRepository } =
        createDirectory();

      clientsRepository.find.mockResolvedValue([makeClient()]);
      // Only a leadflow row exists — the repository query itself filters by
      // productKey, so a social lookup would never even receive this row in
      // production; mirroring that here (not returning it) is what proves
      // the client is absent, not a `.filter()` added on top.
      entitlementsRepository.find.mockResolvedValue([]);

      await expect(
        directory.listAuthorizedClients(owner, 'social'),
      ).resolves.toEqual([]);
    });

    it('client G: an active Social entitlement with no product-specific access for the calling user does not appear', async () => {
      const {
        directory,
        clientsRepository,
        entitlementsRepository,
        clientAccessRepository,
        clientProductAccessRepository,
      } = createDirectory();

      clientsRepository.find.mockResolvedValue([makeClient()]);
      entitlementsRepository.find.mockResolvedValue([
        makeEntitlement({
          productKey: 'social',
          status: ProductEntitlementStatus.Active,
        }),
      ]);
      // The user has client access (can see the client at all) but no
      // *product*-specific access row for social — a non-privileged member,
      // not owner/admin, must be denied even though entitlement is active.
      clientAccessRepository.find.mockResolvedValue([
        { clientId: 'client-1', managedTenantId: 'managed-tenant-1' },
      ]);
      clientProductAccessRepository.find.mockResolvedValue([]);

      await expect(
        directory.listAuthorizedClients(member, 'social'),
      ).resolves.toEqual([]);
    });

    it('every entry returned for productKey social carries an active or trial-valid entitlement status', async () => {
      const { directory, clientsRepository, entitlementsRepository } =
        createDirectory();

      clientsRepository.find.mockResolvedValue([
        makeClient(),
        makeClient({
          id: 'client-2',
          managedTenantId: 'managed-tenant-2',
          displayName: 'Empresa B',
        }),
      ]);
      entitlementsRepository.find.mockResolvedValue([
        makeEntitlement({
          productKey: 'social',
          status: ProductEntitlementStatus.Active,
        }),
        makeEntitlement({
          tenantId: 'managed-tenant-2',
          productKey: 'social',
          status: ProductEntitlementStatus.Suspended,
        }),
      ]);

      const entries = await directory.listAuthorizedClients(owner, 'social');

      expect(entries).toHaveLength(1);
      expect(
        entries.every((entry) =>
          ['active', 'trial'].includes(entry.entitlement.status),
        ),
      ).toBe(true);
    });
  });
});

describe('ManagedContextDirectoryService.resolveActiveContext', () => {
  it('keeps the agency context when no client mode is requested', async () => {
    const { directory, clientsRepository } = createDirectory();

    const resolution = await directory.resolveActiveContext(
      member,
      requested({ operatingMode: 'agency', clientId: null }),
    );

    expect(resolution.active).toEqual({
      kind: 'agency',
      productKey: 'leadflow',
      clientId: null,
      companyContextId: null,
      managedTenantId: null,
      displayName: null,
    });
    expect(resolution.rejection).toBeNull();
    expect(clientsRepository.findOne).not.toHaveBeenCalled();
  });

  it('activates a company the caller is authorized to operate', async () => {
    const { directory, clientsRepository, entitlementsRepository } =
      createDirectory();

    clientsRepository.findOne.mockResolvedValue(makeClient());
    entitlementsRepository.findOne.mockResolvedValue(makeEntitlement());

    const resolution = await directory.resolveActiveContext(owner, requested());

    expect(resolution.active).toEqual({
      kind: 'client',
      productKey: 'leadflow',
      clientId: 'client-1',
      companyContextId: null,
      managedTenantId: 'managed-tenant-1',
      displayName: 'Empresa A',
    });
    expect(resolution.rejection).toBeNull();
  });

  it('falls back to the agency context when access was revoked', async () => {
    const {
      directory,
      clientsRepository,
      entitlementsRepository,
      clientAccessRepository,
    } = createDirectory();

    clientsRepository.findOne.mockResolvedValue(makeClient());
    entitlementsRepository.findOne.mockResolvedValue(makeEntitlement());
    clientAccessRepository.findOne.mockResolvedValue(null);

    const resolution = await directory.resolveActiveContext(
      member,
      requested(),
    );

    expect(resolution.active.kind).toBe('agency');
    expect(resolution.rejection).toEqual({
      code: 'context_not_authorized',
      requestedClientId: 'client-1',
      requestedCompanyContextId: null,
      requestedProductKey: 'leadflow',
    });
  });

  it('refuses a stale selection pointing at another workspace', async () => {
    const { directory, clientsRepository } = createDirectory();

    // The client row exists, but not under the workspace of this session.
    clientsRepository.findOne.mockResolvedValue(null);

    const resolution = await directory.resolveActiveContext(
      owner,
      requested({ clientId: 'client-from-workspace-2' }),
    );

    expect(resolution.active.kind).toBe('agency');
    expect(resolution.rejection?.code).toBe('context_not_authorized');
  });

  it('refuses a client that is no longer active', async () => {
    const { directory, clientsRepository } = createDirectory();
    clientsRepository.findOne.mockResolvedValue(
      makeClient({ status: 'paused' }),
    );

    const resolution = await directory.resolveActiveContext(owner, requested());

    expect(resolution.active.kind).toBe('agency');
    expect(resolution.rejection?.code).toBe('context_not_authorized');
  });

  it('refuses a company whose entitlement expired since the session started', async () => {
    const { directory, clientsRepository, entitlementsRepository } =
      createDirectory();

    clientsRepository.findOne.mockResolvedValue(makeClient());
    entitlementsRepository.findOne.mockResolvedValue(
      makeEntitlement({ endsAt: new Date(Date.now() - 1000) }),
    );

    const resolution = await directory.resolveActiveContext(owner, requested());

    expect(resolution.active.kind).toBe('agency');
    expect(resolution.rejection?.code).toBe('context_not_authorized');
  });

  it('reports a missing client id instead of throwing', async () => {
    const { directory } = createDirectory();

    const resolution = await directory.resolveActiveContext(
      owner,
      requested({ clientId: null }),
    );

    expect(resolution.active.kind).toBe('agency');
    expect(resolution.rejection?.code).toBe('client_id_missing');
  });

  it('rejects a company context when the Agency Client id is missing', async () => {
    const { directory } = createDirectory();

    const resolution = await directory.resolveActiveContext(
      owner,
      requested({ clientId: null, companyContextId: 'company-context-1' }),
    );

    expect(resolution.active.kind).toBe('agency');
    expect(resolution.rejection?.code).toBe(
      'company_context_client_id_missing',
    );
  });

  it('activates a valid Agency Client and Company Context pair', async () => {
    const {
      directory,
      clientsRepository,
      companyContextsRepository,
      contactsRepository,
      entitlementsRepository,
    } = createDirectory();
    clientsRepository.findOne.mockResolvedValue(makeClient());
    entitlementsRepository.findOne.mockResolvedValue(makeEntitlement());
    companyContextsRepository.findOne.mockResolvedValue(makeCompanyContext());
    contactsRepository.findOne.mockResolvedValue(makeCompanyContact());

    const resolution = await directory.resolveActiveContext(
      owner,
      requested({ companyContextId: 'company-context-1' }),
    );

    expect(resolution.active).toEqual({
      kind: 'client',
      productKey: 'leadflow',
      clientId: 'client-1',
      companyContextId: 'company-context-1',
      managedTenantId: 'managed-tenant-1',
      displayName: 'Empresa A',
    });
    expect(resolution.rejection).toBeNull();
  });

  it.each([
    ['inexistent', null, 'company_context_not_available'],
    [
      'other client',
      makeCompanyContext({ agencyClientId: 'client-2' }),
      'company_context_not_available',
    ],
    [
      'other tenant',
      makeCompanyContext({ tenantId: 'tenant-other' }),
      'company_context_not_available',
    ],
    [
      'other workspace',
      makeCompanyContext({ workspaceId: 'workspace-other' }),
      'company_context_not_available',
    ],
    [
      'inactive',
      makeCompanyContext({ status: 'inactive' }),
      'company_context_inactive',
    ],
    [
      'archived',
      makeCompanyContext({ status: 'archived' }),
      'company_context_archived',
    ],
    [
      'archived timestamp',
      makeCompanyContext({ archivedAt: new Date() }),
      'company_context_archived',
    ],
  ])(
    'refuses a %s company context without activating it',
    async (_label, companyContext, code) => {
      const {
        directory,
        clientsRepository,
        companyContextsRepository,
        entitlementsRepository,
      } = createDirectory();
      clientsRepository.findOne.mockResolvedValue(makeClient());
      entitlementsRepository.findOne.mockResolvedValue(makeEntitlement());
      companyContextsRepository.findOne.mockResolvedValue(companyContext);

      const resolution = await directory.resolveActiveContext(
        owner,
        requested({ companyContextId: 'company-context-1' }),
      );

      expect(resolution.active.kind).toBe('agency');
      expect(resolution.rejection?.code).toBe(code);
      expect(resolution.rejection?.requestedCompanyContextId).toBe(
        'company-context-1',
      );
    },
  );

  it('rejects a selected context whose organization Contact is no longer valid', async () => {
    const {
      directory,
      clientsRepository,
      companyContextsRepository,
      contactsRepository,
      entitlementsRepository,
    } = createDirectory();
    clientsRepository.findOne.mockResolvedValue(makeClient());
    entitlementsRepository.findOne.mockResolvedValue(makeEntitlement());
    companyContextsRepository.findOne.mockResolvedValue(makeCompanyContext());
    contactsRepository.findOne.mockResolvedValue(null);

    const resolution = await directory.resolveActiveContext(
      owner,
      requested({ companyContextId: 'company-context-1' }),
    );

    expect(resolution.active.kind).toBe('agency');
    expect(resolution.rejection?.code).toBe('company_context_not_available');
  });

  it('does not require a company context in agency mode', async () => {
    const { directory, companyContextsRepository } = createDirectory();

    const resolution = await directory.resolveActiveContext(
      owner,
      requested({
        operatingMode: 'agency',
        clientId: null,
        companyContextId: 'stale-company-id',
      }),
    );

    expect(resolution.active.kind).toBe('agency');
    expect(resolution.rejection).toBeNull();
    expect(companyContextsRepository.findOne).not.toHaveBeenCalled();
  });

  it('refuses client mode for a product with no managed scope', async () => {
    const { directory } = createDirectory();

    const resolution = await directory.resolveActiveContext(
      owner,
      requested({ productKey: 'agency' }),
    );

    expect(resolution.active.kind).toBe('agency');
    expect(resolution.rejection?.code).toBe('product_not_client_scoped');
  });

  it('refuses client mode when the session has no workspace', async () => {
    const { directory } = createDirectory();

    const resolution = await directory.resolveActiveContext(
      { ...owner, workspaceId: null },
      requested(),
    );

    expect(resolution.active.kind).toBe('agency');
    expect(resolution.rejection?.code).toBe('workspace_missing');
  });
});
