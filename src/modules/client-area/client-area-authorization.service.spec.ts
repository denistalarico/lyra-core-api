import { ClientAreaAuthorizationService } from './services/client-area-authorization.service';
import { AgencyClientStatus } from '../clients/enums';

/**
 * CA4.1 — proves `resolveMembershipContext` folds the CRM identity chain
 * (active identity-contact -> active PF -> active contact_company_link ->
 * this company) into the same fail-closed formula as every other check:
 * a membership can no longer authorize on membership/company/organization/
 * Agency-Client validity alone.
 */
describe('CA4.1 ClientAreaAuthorizationService.resolveMembershipContext eligibility', () => {
  const TENANT = 'tenant-1';
  const WORKSPACE = 'workspace-1';
  const CLIENT = 'client-1';
  const COMPANY = 'company-1';
  const USER = 'user-1';
  const SESSION = 'session-1';

  const membership = {
    id: 'membership-1',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    agencyClientId: CLIENT,
    companyContextId: COMPANY,
    userId: USER,
    role: 'client_operator',
    status: 'active',
  };

  const identity = {
    userId: USER,
    tenantId: TENANT,
    sessionId: SESSION,
    email: 'cliente@example.com',
  };

  const company = {
    id: COMPANY,
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    agencyClientId: CLIENT,
    companyContactId: 'contact-org-1',
    status: 'active',
    archivedAt: null,
  };

  const organization = {
    id: 'contact-org-1',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    type: 'organization',
    status: 'active',
    displayName: 'Empresa Cliente',
  };

  const client = {
    id: CLIENT,
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    status: AgencyClientStatus.Active,
    archivedAt: null,
  };

  function buildService(eligible: boolean) {
    const membershipsRepo = { manager: {} };
    const companyContextsRepo = {
      findOne: jest.fn().mockResolvedValue(company),
    };
    const contactsRepo = { findOne: jest.fn().mockResolvedValue(organization) };
    const clientsRepo = { findOne: jest.fn().mockResolvedValue(client) };
    const management = {
      assertAgencyEnabled: jest.fn().mockResolvedValue(undefined),
      resolveCompanyModules: jest.fn().mockResolvedValue({ approvals: false }),
    };
    const eligibilityService = {
      isMembershipEligible: jest.fn().mockResolvedValue(eligible),
    };

    const service = new ClientAreaAuthorizationService(
      membershipsRepo as never,
      companyContextsRepo as never,
      contactsRepo as never,
      clientsRepo as never,
      management as never,
      eligibilityService as never,
    );

    return { service, eligibilityService, management };
  }

  it('returns null when the CRM identity chain is no longer eligible, even though membership/company/organization/client are all valid', async () => {
    const { service } = buildService(false);

    const context = await service.resolveMembershipContext(
      membership as never,
      identity,
    );

    expect(context).toBeNull();
  });

  it('returns the full context when the CRM identity chain is eligible and every other check passes', async () => {
    const { service } = buildService(true);

    const context = await service.resolveMembershipContext(
      membership as never,
      identity,
    );

    expect(context).toMatchObject({
      surface: 'client_area',
      userId: USER,
      tenantId: TENANT,
      companyContextId: COMPANY,
      role: 'client_operator',
    });
  });

  it('calls isMembershipEligible with the membership tenant/user and the resolved company id', async () => {
    const { service, eligibilityService } = buildService(true);

    await service.resolveMembershipContext(membership as never, identity);

    expect(eligibilityService.isMembershipEligible).toHaveBeenCalledWith(
      expect.anything(),
      {
        tenantId: TENANT,
        userId: USER,
        companyContextId: COMPANY,
      },
    );
  });

  it('never calls isMembershipEligible when an earlier check (e.g. membership status) already fails', async () => {
    const { service, eligibilityService } = buildService(true);

    const context = await service.resolveMembershipContext(
      { ...membership, status: 'revoked' } as never,
      identity,
    );

    expect(context).toBeNull();
    expect(eligibilityService.isMembershipEligible).not.toHaveBeenCalled();
  });
});
