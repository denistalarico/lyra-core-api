import { PlatformProductKey } from '../enums/platform-product.enums';

export type PlatformModuleKey =
  | 'agency.dashboard'
  | 'agency.messages'
  | 'agency.calendar'
  | 'agency.tasks'
  | 'agency.projects'
  | 'agency.clients'
  | 'agency.sales'
  | 'agency.finance'
  | 'agency.team'
  | 'agency.knowledge'
  | 'agency.settings'
  | 'leadflow.overview'
  | 'leadflow.inbox'
  | 'leadflow.crm'
  | 'leadflow.agents'
  | 'leadflow.automations'
  | 'leadflow.analytics'
  | 'leadflow.settings'
  | 'social.overview'
  | 'social.planner'
  | 'social.creative_studio'
  | 'social.campaigns'
  | 'social.approvals'
  | 'social.brand_kit'
  | 'social.analytics'
  | 'social.settings';

export const PLATFORM_PRODUCT_MODULES = {
  [PlatformProductKey.Agency]: [
    'agency.dashboard',
    'agency.messages',
    'agency.calendar',
    'agency.tasks',
    'agency.projects',
    'agency.clients',
    'agency.sales',
    'agency.finance',
    'agency.team',
    'agency.knowledge',
    'agency.settings',
  ],
  [PlatformProductKey.LeadFlow]: [
    'leadflow.overview',
    'leadflow.inbox',
    'leadflow.crm',
    'leadflow.agents',
    'leadflow.automations',
    'leadflow.analytics',
    'leadflow.settings',
  ],
  [PlatformProductKey.Social]: [
    'social.overview',
    'social.planner',
    'social.creative_studio',
    'social.campaigns',
    'social.approvals',
    'social.brand_kit',
    'social.analytics',
    'social.settings',
  ],
} as const satisfies Record<PlatformProductKey, readonly PlatformModuleKey[]>;

export const PLATFORM_PRODUCT_KEYS = Object.values(PlatformProductKey);

export function isPlatformProductKey(
  value: string,
): value is PlatformProductKey {
  return PLATFORM_PRODUCT_KEYS.includes(value as PlatformProductKey);
}

export function getProductModuleKeys(
  productKey: PlatformProductKey,
): readonly PlatformModuleKey[] {
  return PLATFORM_PRODUCT_MODULES[productKey];
}

export function getProductForModuleKey(
  moduleKey: string,
): PlatformProductKey | null {
  for (const productKey of PLATFORM_PRODUCT_KEYS) {
    const moduleKeys: readonly string[] = PLATFORM_PRODUCT_MODULES[productKey];

    if (moduleKeys.includes(moduleKey)) {
      return productKey;
    }
  }

  return null;
}
