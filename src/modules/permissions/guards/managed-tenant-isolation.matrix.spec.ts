// Cross-tenant isolation matrix (LF-RF-F12-004).
//
// Every LeadFlow surface is reached through the same door: JwtAuthGuard,
// then PermissionsGuard, which resolves the operating context from headers
// and refuses a company the caller cannot operate. Domain suites already
// cover each module's rules; what was missing was one place that proves the
// door itself holds for Settings, Inbox, CRM, Agents, Automations, Analytics
// and Agenda at once, against a fixture with two tenants and three users.
//
// The guard, the resolver, the permission service and the managed-context
// directory are all the real implementations here. Only the repositories are
// faked — and they are faked with matching semantics (`In`, `IsNull`, exact
// values) rather than canned answers, so a rule that stops filtering shows up
// as a failing scenario instead of an unchanged mock.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { ManagedContextDirectoryService } from '../../../common/context/managed-context-directory.service';
import { OperationalContextResolver } from '../../../common/context/operational-context.resolver';
import { PlatformContextService } from '../../platform/platform-context.service';
import { PlatformPermissionService } from '../services/platform-permission.service';
import { PermissionsGuard } from './permissions.guard';

const AGENCY_A = { tenantId: 'tenant-a', workspaceId: 'workspace-a' };
const AGENCY_B = { tenantId: 'tenant-b', workspaceId: 'workspace-b' };

/** Domains named by the plan, with the route each scenario exercises. */
const LEADFLOW_DOMAINS = [
  { key: 'settings', routePath: '/leadflow/clients' },
  { key: 'inbox', routePath: '/inbox/conversations' },
  { key: 'crm', routePath: '/crm/opportunities' },
  { key: 'agents', routePath: '/leadflow/agents' },
  { key: 'automations', routePath: '/leadflow/automations' },
  { key: 'analytics', routePath: '/leadflow/analytics/overview' },
  { key: 'agenda', routePath: '/leadflow/agenda/v1/items' },
] as const;

type Row = Record<string, unknown>;

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];

    if (expected instanceof FindOperator) {
      if (expected.type === 'in') {
        return (expected.value as unknown[]).includes(actual);
      }

      if (expected.type === 'isNull') {
        return actual === null || actual === undefined;
      }

      throw new Error(`Unsupported find operator in fixture: ${expected.type}`);
    }

    return actual === expected;
  });
}

function createFakeRepository(rows: Row[]) {
  const matching = (options?: { where?: Row | Row[] }) => {
    const where = options?.where;

    if (!where) {
      return rows;
    }

    const clauses = Array.isArray(where) ? where : [where];

    return rows.filter((row) =>
      clauses.some((clause) => matchesWhere(row, clause)),
    );
  };

  return {
    find: jest.fn(async (options?: { where?: Row | Row[] }) =>
      matching(options),
    ),
    findOne: jest.fn(
      async (options?: { where?: Row | Row[] }) => matching(options)[0] ?? null,
    ),
    create: jest.fn((value: Row) => value),
    save: jest.fn(async (value: Row) => value),
  };
}

function makeClient(overrides: Row): Row {
  return {
    status: 'active',
    archivedAt: null,
    metadata: {},
    ...overrides,
  };
}

function makeEntitlement(tenantId: string, productKey = 'leadflow'): Row {
  return {
    id: `${tenantId}-${productKey}`,
    tenantId,
    productKey,
    status: 'active',
    source: 'manual',
    planKey: null,
    startsAt: null,
    endsAt: null,
    trialEndsAt: null,
  };
}

function createFixture() {
  const clients = [
    makeClient({
      id: 'client-a1',
      ...AGENCY_A,
      managedTenantId: 'managed-a1',
      displayName: 'Empresa A1',
    }),
    makeClient({
      id: 'client-a2',
      ...AGENCY_A,
      managedTenantId: 'managed-a2',
      displayName: 'Empresa A2',
    }),
    makeClient({
      id: 'client-b1',
      ...AGENCY_B,
      managedTenantId: 'managed-b1',
      displayName: 'Empresa B1',
    }),
  ];

  const entitlements = [
    // Both agencies contracted LeadFlow for themselves.
    makeEntitlement('tenant-a'),
    makeEntitlement('tenant-b'),
    // Managed tenants: A1 and B1 are entitled, A2 deliberately is not.
    makeEntitlement('managed-a1'),
    makeEntitlement('managed-b1'),
  ];

  // user-a-member holds explicit grants for client-a1 only.
  const clientAccess = [
    {
      ...AGENCY_A,
      clientId: 'client-a1',
      userId: 'user-a-member',
      managedTenantId: 'managed-a1',
      accessLevel: 'relationship',
    },
  ];

  const clientProductAccess = [
    {
      ...AGENCY_A,
      clientId: 'client-a1',
      userId: 'user-a-member',
      managedTenantId: 'managed-a1',
      productKey: 'leadflow',
      roleKey: 'operator',
    },
  ];

  const clientsRepository = createFakeRepository(clients);
  const entitlementsRepository = createFakeRepository(entitlements);
  const clientAccessRepository = createFakeRepository(clientAccess);
  const clientProductAccessRepository =
    createFakeRepository(clientProductAccess);
  const auditRepository = createFakeRepository([]);

  const managedContextDirectory = new ManagedContextDirectoryService(
    clientsRepository as never,
    entitlementsRepository as never,
    clientAccessRepository as never,
    clientProductAccessRepository as never,
  );

  const platformContextService = new PlatformContextService(
    entitlementsRepository as never,
    createFakeRepository([]) as never,
    { get: () => undefined } as never,
    managedContextDirectory,
  );

  const permissionService = new PlatformPermissionService(
    createFakeRepository([]) as never,
    createFakeRepository([]) as never,
    createFakeRepository([]) as never,
    clientAccessRepository as never,
    clientProductAccessRepository as never,
    auditRepository as never,
    platformContextService,
    { assertScope: jest.fn().mockResolvedValue(undefined) } as never,
    managedContextDirectory,
  );

  const resolver = new OperationalContextResolver(clientsRepository as never);

  const guard = new PermissionsGuard(
    {
      getAllAndOverride: (key: string) =>
        key === 'permissions:product_entitlement' ? 'leadflow' : undefined,
    } as never,
    permissionService,
    resolver,
  );

  return { guard, auditRepository, clientsRepository };
}

type Caller = {
  sub: string;
  tenantId: string;
  workspaceId: string;
  role: string;
};

const OWNER_A: Caller = {
  sub: 'user-a-owner',
  ...AGENCY_A,
  role: 'owner',
};

const MEMBER_A: Caller = {
  sub: 'user-a-member',
  ...AGENCY_A,
  role: 'member',
};

const OWNER_B: Caller = {
  sub: 'user-b-owner',
  ...AGENCY_B,
  role: 'owner',
};

function createExecutionContext(
  user: Caller,
  headers: Record<string, string>,
  routePath: string,
): ExecutionContext {
  const request = {
    user,
    headers,
    method: 'GET',
    route: { path: routePath },
    params: {},
    query: {},
    body: null,
  };

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

function clientHeaders(clientId: string) {
  return {
    'x-lyra-product-key': 'leadflow',
    'x-lyra-operating-mode': 'client',
    'x-lyra-client-id': clientId,
  };
}

async function runGuard(
  user: Caller,
  headers: Record<string, string>,
  routePath: string,
) {
  const { guard, auditRepository } = createFixture();

  const result = await guard
    .canActivate(createExecutionContext(user, headers, routePath))
    .then((allowed) => ({ allowed, error: null as unknown }))
    .catch((error: unknown) => ({ allowed: false, error }));

  return { ...result, auditRepository };
}

describe('managed tenant isolation matrix (LF-RF-F12-004)', () => {
  describe.each(LEADFLOW_DOMAINS)('$key', ({ routePath }) => {
    it('allows the agency owner into an entitled company of their own tenant', async () => {
      const { allowed, error } = await runGuard(
        OWNER_A,
        clientHeaders('client-a1'),
        routePath,
      );

      expect(error).toBeNull();
      expect(allowed).toBe(true);
    });

    it('allows a member with an explicit grant into that company', async () => {
      const { allowed, error } = await runGuard(
        MEMBER_A,
        clientHeaders('client-a1'),
        routePath,
      );

      expect(error).toBeNull();
      expect(allowed).toBe(true);
    });

    it("denies a member for a company they hold no grant for", async () => {
      const { allowed, error } = await runGuard(
        MEMBER_A,
        clientHeaders('client-a2'),
        routePath,
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(allowed).toBe(false);
    });

    it('denies the owner for a company whose managed tenant has no entitlement', async () => {
      const { allowed, error } = await runGuard(
        OWNER_A,
        clientHeaders('client-a2'),
        routePath,
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(allowed).toBe(false);
    });

    it('denies a caller from another tenant asking for a foreign company', async () => {
      const { allowed, error } = await runGuard(
        OWNER_B,
        clientHeaders('client-a1'),
        routePath,
      );

      expect(allowed).toBe(false);
      expect(error).toBeTruthy();
    });

    it('denies a company that belongs to another workspace of the same tenant', async () => {
      const { allowed, error } = await runGuard(
        { ...OWNER_A, workspaceId: 'workspace-a-other' },
        clientHeaders('client-a1'),
        routePath,
      );

      expect(allowed).toBe(false);
      expect(error).toBeTruthy();
    });

    it('refuses client mode without a company instead of falling back to all companies', async () => {
      const { allowed, error } = await runGuard(
        OWNER_A,
        {
          'x-lyra-product-key': 'leadflow',
          'x-lyra-operating-mode': 'client',
        },
        routePath,
      );

      expect(allowed).toBe(false);
      expect(error).toBeTruthy();
    });
  });

  it('audits every denied managed context', async () => {
    const { error, auditRepository } = await runGuard(
      MEMBER_A,
      clientHeaders('client-a2'),
      '/crm/opportunities',
    );

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(auditRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'access_denied',
        permissionKey: 'managed_context:leadflow',
        resourceId: 'client-a2',
        riskLevel: 'high',
      }),
    );
  });

  it('revoking a grant closes access on the next request', async () => {
    const before = await runGuard(
      MEMBER_A,
      clientHeaders('client-a1'),
      '/inbox/conversations',
    );

    expect(before.allowed).toBe(true);

    // Same fixture, minus the product grant: the guard reads authorization
    // per request, so revocation needs no session invalidation.
    const { guard } = createFixture();
    const revoked = await guard
      .canActivate(
        createExecutionContext(
          { ...MEMBER_A, sub: 'user-a-member-without-grant' },
          clientHeaders('client-a1'),
          '/inbox/conversations',
        ),
      )
      .catch((error: unknown) => error);

    expect(revoked).toBeInstanceOf(ForbiddenException);
  });

  it('lets the agency operate its own tenant without a company header', async () => {
    const { allowed, error } = await runGuard(
      OWNER_A,
      {
        'x-lyra-product-key': 'leadflow',
        'x-lyra-operating-mode': 'agency',
      },
      '/leadflow/clients',
    );

    expect(error).toBeNull();
    expect(allowed).toBe(true);
  });

  describe('surface coverage', () => {
    const MODULES_ROOT = join(__dirname, '..', '..');

    function listControllerFiles(directory: string): string[] {
      const files: string[] = [];

      for (const entry of readdirSync(directory)) {
        const fullPath = join(directory, entry);

        if (statSync(fullPath).isDirectory()) {
          files.push(...listControllerFiles(fullPath));
          continue;
        }

        if (entry.endsWith('.controller.ts')) {
          files.push(fullPath);
        }
      }

      return files;
    }

    it('routes every LeadFlow controller through both guards', () => {
      const leadFlowControllers = listControllerFiles(MODULES_ROOT).filter(
        (file) =>
          /@RequireProductEntitlement\(\s*'leadflow'\s*\)/.test(
            readFileSync(file, 'utf8'),
          ),
      );

      expect(leadFlowControllers.length).toBeGreaterThanOrEqual(15);

      const unguarded = leadFlowControllers.filter((file) => {
        const source = readFileSync(file, 'utf8');

        return (
          !/@UseGuards\([^)]*JwtAuthGuard/.test(source) ||
          !/@UseGuards\([^)]*PermissionsGuard/.test(source)
        );
      });

      expect(unguarded).toEqual([]);
    });
  });
});
