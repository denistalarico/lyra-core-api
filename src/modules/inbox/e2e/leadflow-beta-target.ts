export type LeadFlowBetaTarget = {
  agencyUrl: string;
  apiUrl: string;
  email: string;
  password: string;
  otp?: string;
  teamMemberId?: string;
};

function normalizedUrl(value: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name}_invalid`);
  }
  const isLocal =
    parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (
    parsed.protocol !== 'https:' &&
    !(isLocal && parsed.protocol === 'http:')
  ) {
    throw new Error(`${name}_must_use_https`);
  }
  return parsed.toString().replace(/\/$/, '');
}

export function resolveLeadFlowBetaTarget(
  env: NodeJS.ProcessEnv,
): LeadFlowBetaTarget {
  const required = [
    'LEADFLOW_BETA_AGENCY_URL',
    'LEADFLOW_BETA_API_URL',
    'LEADFLOW_BETA_EMAIL',
    'LEADFLOW_BETA_PASSWORD',
  ] as const;
  for (const key of required) {
    if (!env[key]?.trim()) throw new Error(`${key.toLowerCase()}_missing`);
  }

  const agencyUrl = normalizedUrl(
    env.LEADFLOW_BETA_AGENCY_URL!,
    'leadflow_beta_agency_url',
  );
  const apiUrl = normalizedUrl(
    env.LEADFLOW_BETA_API_URL!,
    'leadflow_beta_api_url',
  );
  const productionHosts = new Set([
    'agency.lyrasuite.com',
    'api.lyrasuite.com',
  ]);
  const targetsProduction =
    productionHosts.has(new URL(agencyUrl).hostname) ||
    productionHosts.has(new URL(apiUrl).hostname);
  if (targetsProduction && env.LEADFLOW_BETA_E2E_ALLOW_PRODUCTION !== 'true') {
    throw new Error('leadflow_beta_production_target_blocked');
  }

  return {
    agencyUrl,
    apiUrl,
    email: env.LEADFLOW_BETA_EMAIL!.trim(),
    password: env.LEADFLOW_BETA_PASSWORD!,
    otp: env.LEADFLOW_BETA_OTP?.trim() || undefined,
    teamMemberId: env.LEADFLOW_BETA_TEAM_MEMBER_ID?.trim() || undefined,
  };
}

export function leadFlowBetaRoutes(target: LeadFlowBetaTarget): string[] {
  const routes = [
    '/leadflow/inbox',
    '/leadflow/crm',
    '/leadflow/appointments',
    '/leadflow/automations',
    '/leadflow/agents',
    '/leadflow/analytics',
    '/leadflow/settings',
  ];
  if (target.teamMemberId) {
    routes.push(`/team/members/${encodeURIComponent(target.teamMemberId)}`);
  }
  return routes;
}

export function socketIoUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  url.pathname = '/socket.io/';
  url.search = 'EIO=4&transport=polling';
  return url.toString();
}
