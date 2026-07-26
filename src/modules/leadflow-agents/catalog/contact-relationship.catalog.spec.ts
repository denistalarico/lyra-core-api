import { LeadFlowServiceAudience } from '../enums/leadflow-service-audience.enum';
import {
  audienceServesRelationship,
  ContactRelationship,
  resolveContactRelationship,
} from './contact-relationship.catalog';

describe('resolveContactRelationship', () => {
  it('lets an internal user win over every other signal (safety)', () => {
    expect(
      resolveContactRelationship({
        isInternalUser: true,
        isCustomer: true,
        isLead: true,
      }),
    ).toBe(ContactRelationship.InternalUser);
  });

  it('resolves a proven customer', () => {
    expect(
      resolveContactRelationship({
        isInternalUser: false,
        isCustomer: true,
        isLead: true,
      }),
    ).toBe(ContactRelationship.Customer);
  });

  it('resolves a lead', () => {
    expect(
      resolveContactRelationship({
        isInternalUser: false,
        isCustomer: false,
        isLead: true,
      }),
    ).toBe(ContactRelationship.Lead);
  });

  it('is unknown when no canonical signal classifies the contact', () => {
    expect(
      resolveContactRelationship({
        isInternalUser: false,
        isCustomer: false,
        isLead: false,
      }),
    ).toBe(ContactRelationship.Unknown);
  });
});

describe('audienceServesRelationship', () => {
  it('never serves an internal user, whatever the audience', () => {
    for (const audience of Object.values(LeadFlowServiceAudience)) {
      expect(
        audienceServesRelationship(audience, ContactRelationship.InternalUser),
      ).toBe(false);
    }
  });

  it('never blocks an unknown relationship (filtering only refuses a definite mismatch)', () => {
    for (const audience of Object.values(LeadFlowServiceAudience)) {
      expect(
        audienceServesRelationship(audience, ContactRelationship.Unknown),
      ).toBe(true);
    }
  });

  it('a leads-only agent serves leads but not customers', () => {
    expect(
      audienceServesRelationship(
        LeadFlowServiceAudience.Leads,
        ContactRelationship.Lead,
      ),
    ).toBe(true);
    expect(
      audienceServesRelationship(
        LeadFlowServiceAudience.Leads,
        ContactRelationship.Customer,
      ),
    ).toBe(false);
  });

  it('a customers-only agent serves customers but not leads', () => {
    expect(
      audienceServesRelationship(
        LeadFlowServiceAudience.Customers,
        ContactRelationship.Customer,
      ),
    ).toBe(true);
    expect(
      audienceServesRelationship(
        LeadFlowServiceAudience.Customers,
        ContactRelationship.Lead,
      ),
    ).toBe(false);
  });

  it('a leads_and_customers agent serves both', () => {
    expect(
      audienceServesRelationship(
        LeadFlowServiceAudience.LeadsAndCustomers,
        ContactRelationship.Lead,
      ),
    ).toBe(true);
    expect(
      audienceServesRelationship(
        LeadFlowServiceAudience.LeadsAndCustomers,
        ContactRelationship.Customer,
      ),
    ).toBe(true);
  });
});
