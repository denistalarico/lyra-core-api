import { projectAgencyPermissions } from '../../client-area/client-area-agency-permission-projection';
import { ForbiddenException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { ClientAreaBridgeRegistry } from '../../../common/client-area-bridge/client-area-bridge.registry';
import type {
  ClientAreaAccessLevel,
  ClientAreaContext,
  ClientAreaModuleKey,
} from '../../client-area/client-area.types';
import { LeadFlowClientAreaScopeService } from '../../leadflow-client-area/leadflow-client-area-scope.service';
import { PermissionScopeEvaluatorService } from '../../permissions/services/permission-scope-evaluator.service';
import type { PlatformPermissionService } from '../../permissions/services/platform-permission.service';
import type { PermissionScopeRequest } from '../../permissions/types/permission-context.types';
import {
  OrionToolAccessService,
  type OrionAccess,
} from './orion-tool-access.service';
import { ORION_TOOL_CATALOG } from './orion-tool-catalog';

const LEADFLOW_MODULES: ClientAreaModuleKey[] = [
  'leadflow_inbox',
  'leadflow_crm',
  'leadflow_appointments',
  'leadflow_agents',
];
const permissioned = ORION_TOOL_CATALOG.filter((tool) => tool.requirement);

function agencyPermissions(held: ReadonlySet<string>) {
  const scopeRequests: PermissionScopeRequest[] = [];
  const service = {
    assertAny: jest.fn(
      (_ctx: unknown, keys: string[], request: PermissionScopeRequest) => {
        scopeRequests.push(request);
        if (!keys.some((key) => held.has(key)))
          return Promise.reject(new ForbiddenException());
        return Promise.resolve();
      },
    ),
  };
  return {
    service: service as unknown as PlatformPermissionService,
    scopeRequests,
  };
}

function realClientAreaEvaluator(resolve = true) {
  const registry = new ClientAreaBridgeRegistry();
  if (resolve)
    new LeadFlowClientAreaScopeService(
      { query: jest.fn().mockResolvedValue([]) } as unknown as DataSource,
      registry,
    ).onModuleInit();
  else
    for (const module of LEADFLOW_MODULES)
      registry.registerScopeResolver(module, () => Promise.resolve(null));
  const dependencies = Array(
    (
      Reflect.getMetadata(
        'design:paramtypes',
        PermissionScopeEvaluatorService,
      ) as unknown[]
    ).length,
  ).fill({});
  dependencies[dependencies.length - 1] = registry;
  return Reflect.construct(
    PermissionScopeEvaluatorService,
    dependencies,
  ) as PermissionScopeEvaluatorService;
}

function clientAccess(
  level: ClientAreaAccessLevel,
  available: Partial<Record<ClientAreaModuleKey, boolean>> = {},
): OrionAccess {
  const memberAccess = Object.fromEntries(
    LEADFLOW_MODULES.map((module) => [
      module,
      { available: available[module] ?? true, level },
    ]),
  );
  return {
    kind: 'client_area',
    context: {
      tenantId: 'tenant',
      workspaceId: 'workspace',
      agencyClientId: 'client',
      companyContextId: 'company',
      userId: 'user',
      memberAccess,
    } as unknown as ClientAreaContext,
  };
}

const agency: OrionAccess = {
  kind: 'agency',
  permission: {
    tenantId: 'tenant',
    workspaceId: 'workspace',
    userId: 'user',
    role: 'member',
  },
};

describe('OrionToolAccessService — permission matrix per tool', () => {
  it.each(permissioned.map((tool) => [tool.name, tool] as const))(
    'Agency: %s needs one of its route keys, checked with the route scope',
    async (_name, tool) => {
      const requirement = tool.requirement!;
      const denied = agencyPermissions(new Set());
      await expect(
        new OrionToolAccessService(denied.service, {} as never).allowed(
          agency,
          requirement,
        ),
      ).resolves.toBe(false);

      for (const key of requirement.agency.anyOf) {
        const allowed = agencyPermissions(new Set([key]));
        await expect(
          new OrionToolAccessService(allowed.service, {} as never).allowed(
            agency,
            requirement,
          ),
        ).resolves.toBe(true);
        expect(allowed.scopeRequests[0]).toMatchObject({
          method: requirement.agency.method ?? 'GET',
          routePath: requirement.agency.routePath,
          body: null,
        });
      }
    },
  );

  it.each(
    permissioned.flatMap((tool) =>
      (['viewer', 'operator', 'manager'] as const).map(
        (level) => [tool.name, level, tool] as const,
      ),
    ),
  )(
    'Client Area: %s at %s reads through the bridge route of its module',
    async (_name, level, tool) => {
      const exposure = tool.requirement!.clientArea!;
      const service = new OrionToolAccessService(
        {} as never,
        realClientAreaEvaluator(),
      );
      // Reads open at every level; OR5's proposal tool (POST) only where
      // the level projects the room proposal grant (`manager`).
      const method = exposure.method ?? 'GET';
      const projected = projectAgencyPermissions(exposure.module, level).some(
        (grant) => grant.key === exposure.key && grant.methods.includes(method),
      );
      expect(projected).toBe(method === 'GET' || level === 'manager');
      await expect(
        service.allowed(clientAccess(level), tool.requirement!),
      ).resolves.toBe(projected);
      // The module switched off for the member denies, whatever the level.
      await expect(
        service.allowed(
          clientAccess(level, { [exposure.module]: false }),
          tool.requirement!,
        ),
      ).resolves.toBe(false);
    },
  );

  it('Client Area: a scope the bridge cannot prove is denied', async () => {
    const service = new OrionToolAccessService(
      {} as never,
      realClientAreaEvaluator(false),
    );
    for (const tool of permissioned)
      await expect(
        service.allowed(clientAccess('manager'), tool.requirement!),
      ).resolves.toBe(false);
  });

  it('Client Area: a tool with no bridge exposure is denied; Agency roles never apply', async () => {
    const service = new OrionToolAccessService(
      { assertAny: jest.fn().mockResolvedValue(undefined) } as never,
      realClientAreaEvaluator(),
    );
    await expect(
      service.allowed(clientAccess('manager'), {
        agency: {
          anyOf: ['leadflow.agents.agent.view.client'],
          routePath: '/x',
        },
        clientArea: null,
      }),
    ).resolves.toBe(false);
  });

  it.each(permissioned.map((tool) => [tool.name, tool] as const))(
    'OR7 client chat (Agency author): %s needs the Agency key AND the company module',
    async (_name, tool) => {
      const requirement = tool.requirement!;
      const exposure = requirement.clientArea!;
      const held = new Set(requirement.agency.anyOf);
      const chat = (enabled: boolean): OrionAccess => ({
        ...agency,
        clientVisible: {
          modules: { [exposure.module]: enabled } as never,
        },
      });

      const both = agencyPermissions(held);
      await expect(
        new OrionToolAccessService(both.service, {} as never).allowed(
          chat(true),
          requirement,
        ),
      ).resolves.toBe(true);

      // Module off for the company: denied before the Agency key is checked.
      const moduleOff = agencyPermissions(held);
      await expect(
        new OrionToolAccessService(moduleOff.service, {} as never).allowed(
          chat(false),
          requirement,
        ),
      ).resolves.toBe(false);
      expect(moduleOff.scopeRequests).toHaveLength(0);

      // Module on, but the operator lacks the key.
      const keyless = agencyPermissions(new Set());
      await expect(
        new OrionToolAccessService(keyless.service, {} as never).allowed(
          chat(true),
          requirement,
        ),
      ).resolves.toBe(false);
    },
  );

  it('OR7 client chat (Agency author): an Agency-only route is denied even with the key', async () => {
    const allowed = agencyPermissions(new Set(['agency.finance.view']));
    await expect(
      new OrionToolAccessService(allowed.service, {} as never).allowed(
        {
          ...agency,
          clientVisible: { modules: { leadflow_agents: true } as never },
        },
        {
          agency: { anyOf: ['agency.finance.view'], routePath: '/finance' },
          clientArea: null,
        },
      ),
    ).resolves.toBe(false);
  });

  it('re-throws anything that is not a denial', async () => {
    const service = new OrionToolAccessService(
      { assertAny: jest.fn().mockRejectedValue(new Error('db down')) } as never,
      {} as never,
    );
    await expect(
      service.allowed(agency, permissioned[0].requirement!),
    ).rejects.toThrow('db down');
  });
});
