import { Module, type OnModuleInit, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ClientAreaBridgeRegistry,
  ClientAreaBridgeRegistryModule,
  type ClientAreaScopedResource,
} from '../../common/client-area-bridge/client-area-bridge.registry';
import { PermissionScopeEvaluatorService } from '../permissions/services/permission-scope-evaluator.service';
import type { ClientAreaContext } from './client-area.types';

const context = {
  tenantId: 'tenant',
  workspaceId: 'workspace',
  agencyClientId: 'client',
  companyContextId: 'company',
  userId: 'user',
} as ClientAreaContext;
let row: ClientAreaScopedResource | null;
const resolver = jest.fn(() => Promise.resolve(row));
@Module({ imports: [ClientAreaBridgeRegistryModule] })
class ProductScopeAdapter implements OnModuleInit {
  constructor(private readonly registry: ClientAreaBridgeRegistry) {}
  onModuleInit() {
    this.registry.registerScopeResolver('leadflow_crm', resolver);
  }
}

describe('CA7 product scope port (consumer registry + adapter init)', () => {
  it('wires an adapter without a third-party DI token, and independently confines tenant/company/creator', async () => {
    const ref = await Test.createTestingModule({
      imports: [ProductScopeAdapter],
    }).compile();
    await ref.init();
    const registry = ref.get(ClientAreaBridgeRegistry);
    const count = (
      Reflect.getMetadata(
        'design:paramtypes',
        PermissionScopeEvaluatorService,
      ) as unknown[]
    ).length;
    const deps = Array.from({ length: count }, () => ({}));
    deps[count - 1] = registry;
    const evaluator = Reflect.construct(
      PermissionScopeEvaluatorService,
      deps,
    ) as PermissionScopeEvaluatorService;
    const valid: ClientAreaScopedResource = {
      tenantId: 'tenant',
      workspaceId: 'workspace',
      agencyClientId: 'client',
      companyContextId: 'company',
      createdById: 'user',
    };
    row = valid;
    await expect(
      evaluator.assertClientAreaScope(
        context,
        'leadflow_crm',
        'leadflow.crm.records.view.client',
        { method: 'GET' },
        false,
      ),
    ).resolves.toBeUndefined();
    for (const key of [
      'tenantId',
      'workspaceId',
      'agencyClientId',
      'companyContextId',
    ] as const) {
      row = { ...valid, [key]: 'foreign' };
      await expect(
        evaluator.assertClientAreaScope(
          context,
          'leadflow_crm',
          'leadflow.crm.records.view.client',
          { method: 'GET' },
          false,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      row = valid;
    }
    row = { ...valid, createdById: 'another' };
    await expect(
      evaluator.assertClientAreaScope(
        context,
        'leadflow_crm',
        'leadflow.crm.records.view.client',
        { method: 'PATCH' },
        true,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      evaluator.assertClientAreaScope(
        context,
        'leadflow_inbox',
        'leadflow.crm.records.view.client',
        { method: 'GET' },
        false,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    row = null;
    await expect(
      evaluator.assertClientAreaScope(
        context,
        'leadflow_crm',
        'leadflow.crm.records.view.client',
        { method: 'GET' },
        false,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(resolver).toHaveBeenCalled();
    await ref.close();
  });
});
