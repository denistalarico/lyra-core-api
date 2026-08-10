import {
  leadFlowBetaRoutes,
  resolveLeadFlowBetaTarget,
  socketIoUrl,
} from './leadflow-beta-target';

const baseEnv = {
  LEADFLOW_BETA_AGENCY_URL: 'http://127.0.0.1:3203',
  LEADFLOW_BETA_API_URL: 'http://127.0.0.1:3200/api',
  LEADFLOW_BETA_EMAIL: 'beta@example.test',
  LEADFLOW_BETA_PASSWORD: 'secret',
};

describe('LeadFlow beta E2E target guard', () => {
  it('accepts an explicit development target and normalizes URLs', () => {
    const target = resolveLeadFlowBetaTarget(baseEnv);
    expect(target).toMatchObject({
      agencyUrl: 'http://127.0.0.1:3203',
      apiUrl: 'http://127.0.0.1:3200/api',
    });
    expect(leadFlowBetaRoutes(target)).toHaveLength(7);
    expect(socketIoUrl(target.apiUrl)).toBe(
      'http://127.0.0.1:3200/socket.io/?EIO=4&transport=polling',
    );
  });

  it('blocks production unless the operator opts in explicitly', () => {
    expect(() =>
      resolveLeadFlowBetaTarget({
        ...baseEnv,
        LEADFLOW_BETA_AGENCY_URL: 'https://agency.lyrasuite.com',
        LEADFLOW_BETA_API_URL: 'https://api.lyrasuite.com/api',
      }),
    ).toThrow('leadflow_beta_production_target_blocked');
  });

  it('fails closed for missing credentials or insecure remote URLs', () => {
    expect(() =>
      resolveLeadFlowBetaTarget({
        ...baseEnv,
        LEADFLOW_BETA_PASSWORD: '',
      }),
    ).toThrow('leadflow_beta_password_missing');
    expect(() =>
      resolveLeadFlowBetaTarget({
        ...baseEnv,
        LEADFLOW_BETA_AGENCY_URL: 'http://dev-agency.example.test',
      }),
    ).toThrow('leadflow_beta_agency_url_must_use_https');
  });

  it('adds a concrete team member route only when a fixture is supplied', () => {
    const target = resolveLeadFlowBetaTarget({
      ...baseEnv,
      LEADFLOW_BETA_TEAM_MEMBER_ID: 'member-123',
    });
    expect(leadFlowBetaRoutes(target)).toContain('/team/members/member-123');
  });
});
