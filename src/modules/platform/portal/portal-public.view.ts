// src/modules/platform/portal/portal-public.view.ts
//
// Sanitized read contract for anything the Portal may show a client
// (LF-RF-F12-003, blueprint sections 9, 14 and 24).
//
// The rule this file exists to enforce: a public payload is built by
// *construction*, never by deletion. Nothing is spread from an entity, so a
// column added tomorrow — a new prompt, a new token, a new internal flag —
// cannot appear here by accident. Adding a public field requires editing the
// builder, which is exactly the review moment the Portal needs.
//
// The Portal is an add-on of Lyra Agency, not a separate SaaS: the agency
// controls the branding, and Lyra keeps a discreet, non-removable
// attribution.

export const PORTAL_CONTRACT_VERSION = 1;

export const POWERED_BY_LABEL = 'Powered by Lyra';

const MAX_TEXT_LENGTH = 120;
const MAX_LINK_LABEL_LENGTH = 60;
const MAX_LINKS = 6;

const DEFAULT_PRIMARY_COLOR = '#4F46E5';
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const EMAIL_PATTERN = /^[^\s@<>"']+@[^\s@<>"'.]+\.[^\s@<>"']+$/;

/** Apps the Portal may reveal. Anything else stays invisible to the client. */
export const PORTAL_PUBLIC_APP_KEYS = [
  'inbox',
  'crm',
  'agenda',
  'analytics',
] as const;

export type PortalPublicAppKey = (typeof PORTAL_PUBLIC_APP_KEYS)[number];

export interface PortalBrandingPublicView {
  portalName: string | null;
  logoUrl: string | null;
  primaryColor: string;
  supportEmail: string | null;
  supportUrl: string | null;
  links: { label: string; url: string }[];
  /** Lyra attribution. Always present; branding input cannot override it. */
  poweredBy: { label: string; visible: true };
}

export interface PortalCompanyPublicView {
  contractVersion: number;
  companyId: string;
  displayName: string;
  status: string;
  businessModeKey: string | null;
  apps: Record<PortalPublicAppKey, boolean>;
  branding: PortalBrandingPublicView;
}

/**
 * Structural input. Declared here instead of importing the LeadFlow settings
 * entity so this contract does not inherit the entity's shape — the two are
 * meant to drift apart.
 */
export interface PortalCompanySource {
  agencyClientId: string | null;
  displayName: string;
  status: string;
  businessModeKey?: string | null;
  enabledApps?: unknown;
  brandingConfig?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Plain text safe to render as-is. Strips angle brackets and control
 * characters rather than escaping them: the Portal shows a company name, not
 * markup, so there is no legitimate input that needs them.
 */
export function sanitizePortalText(
  value: unknown,
  maxLength = MAX_TEXT_LENGTH,
): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(new RegExp("[\\u0000-\\u001f\\u007f]", "g"), " ")
    .replace(/[<>]/g, '')
    .trim();

  if (!cleaned) {
    return null;
  }

  return cleaned.slice(0, maxLength);
}

/**
 * Absolute https URL, or a site-relative path. Everything else — `javascript:`,
 * `data:`, `vbscript:`, plain http, protocol-relative — is dropped.
 */
export function sanitizePortalUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const candidate = value.trim();

  if (!candidate || /[\u0000-\u0020<>"']/u.test(candidate)) {
    return null;
  }

  if (candidate.startsWith('//')) {
    return null;
  }

  if (candidate.startsWith('/')) {
    return candidate.slice(0, 2048);
  }

  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  return parsed.protocol === 'https:' ? parsed.toString().slice(0, 2048) : null;
}

export function sanitizePortalColor(value: unknown): string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value.trim())
    ? value.trim().toLowerCase()
    : DEFAULT_PRIMARY_COLOR.toLowerCase();
}

export function sanitizePortalEmail(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const candidate = value.trim();

  return EMAIL_PATTERN.test(candidate) ? candidate.slice(0, 254) : null;
}

/**
 * Builds the branding block from agency-controlled input. Whatever the agency
 * stored, the result is a fixed set of fields with validated values — the
 * attribution included.
 */
export function toPortalBrandingView(
  brandingConfig: unknown,
): PortalBrandingPublicView {
  const raw = asRecord(brandingConfig);
  const rawLinks = Array.isArray(raw.links) ? raw.links : [];

  const links = rawLinks
    .map((entry) => {
      const link = asRecord(entry);
      const label = sanitizePortalText(link.label, MAX_LINK_LABEL_LENGTH);
      const url = sanitizePortalUrl(link.url);

      return label && url ? { label, url } : null;
    })
    .filter((link): link is { label: string; url: string } => link !== null)
    .slice(0, MAX_LINKS);

  return {
    portalName: sanitizePortalText(raw.portalName),
    logoUrl: sanitizePortalUrl(raw.logoUrl),
    primaryColor: sanitizePortalColor(raw.primaryColor),
    supportEmail: sanitizePortalEmail(raw.supportEmail),
    supportUrl: sanitizePortalUrl(raw.supportUrl),
    links,
    poweredBy: { label: POWERED_BY_LABEL, visible: true },
  };
}

export function toPortalAppsView(
  enabledApps: unknown,
): Record<PortalPublicAppKey, boolean> {
  const raw = asRecord(enabledApps);

  return PORTAL_PUBLIC_APP_KEYS.reduce(
    (apps, appKey) => {
      apps[appKey] = raw[appKey] === true;
      return apps;
    },
    {} as Record<PortalPublicAppKey, boolean>,
  );
}

/**
 * The company payload the Portal may receive.
 *
 * Deliberately absent, and not by omission: `tenantId`, `workspaceId`,
 * `managedTenantId`, `planKey`, `permissionsConfig`, `agentConfig`,
 * `clientPromptConfig`, `companyContext*`, `enabledIntegrations`,
 * `inboxConfig`, `handoffOverrides`, `developerModeEnabled`, `metadata`,
 * `createdById`/`updatedById` and every third-party identifier. Those are
 * agency-internal (blueprint section 14) or would enable tenant enumeration.
 */
export function toPortalCompanyView(
  source: PortalCompanySource,
): PortalCompanyPublicView | null {
  if (!source.agencyClientId) {
    return null;
  }

  return {
    contractVersion: PORTAL_CONTRACT_VERSION,
    companyId: source.agencyClientId,
    displayName: sanitizePortalText(source.displayName) ?? 'Empresa',
    status: source.status,
    businessModeKey: source.businessModeKey ?? null,
    apps: toPortalAppsView(source.enabledApps),
    branding: toPortalBrandingView(source.brandingConfig),
  };
}

/**
 * Field names that must never appear anywhere in a Portal payload. Used by
 * the contract tests as a second, independent net: the builders above are the
 * real defense, this list catches a future builder that forgets.
 */
export const PORTAL_FORBIDDEN_FIELD_NAMES = [
  'tenantId',
  'tenant_id',
  'workspaceId',
  'workspace_id',
  'managedTenantId',
  'managed_tenant_id',
  'permissionsConfig',
  'agentConfig',
  'clientPromptConfig',
  'companyContextDraft',
  'companyContextPublished',
  'enabledIntegrations',
  'inboxConfig',
  'inboxOverrides',
  'handoffOverrides',
  'developerModeEnabled',
  'metadata',
  'createdById',
  'updatedById',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'prompt',
  'systemPrompt',
  'phoneNumberId',
  'wabaId',
] as const;

/**
 * Collects forbidden keys found anywhere in a payload, at any depth.
 */
export function findForbiddenPortalFields(payload: unknown): string[] {
  const forbidden = new Set<string>(PORTAL_FORBIDDEN_FIELD_NAMES);
  const found = new Set<string>();

  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (typeof value !== 'object' || value === null) {
      return;
    }

    for (const [key, nested] of Object.entries(value)) {
      if (forbidden.has(key)) {
        found.add(key);
      }

      walk(nested);
    }
  };

  walk(payload);

  return [...found].sort();
}
