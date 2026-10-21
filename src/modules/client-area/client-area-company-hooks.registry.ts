import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
export type ClientAreaCompanyScope = CompanyAwareScope & {
  agencyClientId: string;
  companyContextId: string;
};
/** Consumer-owned lifecycle registry; CA13 registers at init without importing analytics here. */
@Injectable()
export class ClientAreaCompanyHooksRegistry {
  private readonly handlers = new Map<
    string,
    (scope: ClientAreaCompanyScope, manager: EntityManager) => Promise<void>
  >();
  register(
    key: string,
    handler: (
      scope: ClientAreaCompanyScope,
      manager: EntityManager,
    ) => Promise<void>,
  ) {
    if (this.handlers.has(key))
      throw new Error(`Duplicate company hook: ${key}`);
    this.handlers.set(key, handler);
  }
  async enabled(scope: ClientAreaCompanyScope, manager: EntityManager) {
    for (const handler of this.handlers.values()) await handler(scope, manager);
  }
}
