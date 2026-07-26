import {
  DEFAULT_SERVICE_AUDIENCE,
  isServiceAudience,
  LeadFlowServiceAudience,
  resolveServiceAudience,
} from './leadflow-service-audience.enum';

describe('service audience', () => {
  it('defaults to leads_and_customers', () => {
    expect(DEFAULT_SERVICE_AUDIENCE).toBe(
      LeadFlowServiceAudience.LeadsAndCustomers,
    );
  });

  it('recognises only the three valid values', () => {
    expect(isServiceAudience('leads')).toBe(true);
    expect(isServiceAudience('customers')).toBe(true);
    expect(isServiceAudience('leads_and_customers')).toBe(true);
    expect(isServiceAudience('internal_user')).toBe(false);
    expect(isServiceAudience(undefined)).toBe(false);
  });

  it('resolves a configured audience', () => {
    expect(resolveServiceAudience({ serviceAudience: 'leads' })).toBe(
      LeadFlowServiceAudience.Leads,
    );
  });

  it('falls back to the default for a missing or invalid value', () => {
    expect(resolveServiceAudience({})).toBe(DEFAULT_SERVICE_AUDIENCE);
    expect(resolveServiceAudience(null)).toBe(DEFAULT_SERVICE_AUDIENCE);
    expect(
      resolveServiceAudience({
        serviceAudience: 'everyone' as unknown as 'leads',
      }),
    ).toBe(DEFAULT_SERVICE_AUDIENCE);
  });
});
