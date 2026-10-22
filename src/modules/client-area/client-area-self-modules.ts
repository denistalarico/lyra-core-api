import type { ConfigService } from '@nestjs/config';
import {
  CLIENT_AREA_MODULE_KEYS,
  type ClientAreaMemberAccess,
  type ClientAreaModuleKey,
} from './client-area.types';

/** CA15 — kill switch of the self modules, independent of the company Bridge. */
export const CLIENT_AREA_SELF_MODULES_ENV = 'CLIENT_AREA_SELF_MODULES_ENABLED';

export function isClientAreaSelfModulesEnabled(
  config: Pick<ConfigService, 'get'>,
) {
  return (
    config.get<string>(CLIENT_AREA_SELF_MODULES_ENV)?.trim().toLowerCase() ===
    'true'
  );
}

export type SelfProductKey = 'social' | 'leadflow';

/**
 * CA15 — modules the agency sees in its own Client Area, over its own data
 * (Agency operating mode). Company-bound modules (approvals, conversations,
 * billing, analytics dashboards) stay off: they would need a fake company
 * scope (PD3 §15/§34).
 */
const SELF_MODULE_PRODUCT: Partial<
  Record<ClientAreaModuleKey, SelfProductKey | null>
> = {
  agency_projects: null,
  social_planner: 'social',
  social_creative_studio: 'social',
  social_campaigns: 'social',
  leadflow_inbox: 'leadflow',
  leadflow_crm: 'leadflow',
  leadflow_appointments: 'leadflow',
  leadflow_agents: 'leadflow',
  settings: null,
};

export function resolveSelfMemberAccess(
  enabled: boolean,
  products: ReadonlySet<SelfProductKey>,
): ClientAreaMemberAccess {
  return Object.fromEntries(
    CLIENT_AREA_MODULE_KEYS.map((key) => {
      if (key === 'overview')
        return [key, { available: true, level: 'viewer' as const }];
      const product = SELF_MODULE_PRODUCT[key];
      const available =
        enabled &&
        product !== undefined &&
        (product === null || products.has(product));
      return [
        key,
        available
          ? { available: true, level: 'manager' as const }
          : {
              available: false,
              level: null,
              reason: !enabled
                ? 'self_modules_disabled'
                : product === undefined
                  ? 'company_bound'
                  : 'product_not_contracted',
            },
      ];
    }),
  ) as ClientAreaMemberAccess;
}
