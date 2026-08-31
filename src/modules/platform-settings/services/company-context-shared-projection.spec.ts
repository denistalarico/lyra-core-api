import {
  mergeSharedCompanyContext,
  pickSharedCompanyContext,
} from './company-context-shared-projection';

describe('pickSharedCompanyContext', () => {
  it('drops the qualification root entirely', () => {
    const projected = pickSharedCompanyContext({
      identity: { publicName: 'Acme' },
      qualification: { conversionGoal: 'book_meeting' },
    });

    expect(projected.qualification).toBeUndefined();
  });

  it('drops LeadFlow-only service subfields but keeps businessHours', () => {
    const projected = pickSharedCompanyContext({
      service: {
        businessHours: 'Mon-Fri',
        handoffRules: 'transfer',
        serviceLevel: '24h',
        emergencyRules: 'call',
        unsupportedRequests: 'refunds',
      },
    });

    expect(projected.service).toEqual({ businessHours: 'Mon-Fri' });
  });

  it('drops identity.legalName but keeps other identity fields', () => {
    const projected = pickSharedCompanyContext({
      identity: {
        publicName: 'Acme',
        legalName: 'Acme Ltda',
        summary: 'We do things',
      },
    });

    expect(projected.identity).toEqual({
      publicName: 'Acme',
      summary: 'We do things',
    });
  });

  it('passes offers/policies/faq/links through untouched', () => {
    const projected = pickSharedCompanyContext({
      offers: ['A'],
      policies: 'no refunds',
      faq: ['Q1?'],
      links: ['https://example.com'],
    });

    expect(projected).toEqual({
      offers: ['A'],
      policies: 'no refunds',
      faq: ['Q1?'],
      links: ['https://example.com'],
    });
  });

  it('exposes contact unchanged without reopening LeadFlow-only roots', () => {
    const contact = {
      website: 'https://example.com',
      phone: '123',
      socialProfiles: [
        { network: 'instagram', url: 'https://instagram.com/acme' },
      ],
      address: { city: 'São Paulo', country: 'BR' },
    };

    const projected = pickSharedCompanyContext({
      contact,
      qualification: { conversionGoal: 'book_meeting' },
      service: { handoffRules: 'transfer' },
    });

    expect(projected.contact).toEqual(contact);
    expect(projected.qualification).toBeUndefined();
    expect(projected.service).toEqual({});
  });

  it('drops legacyTone — no shared classification for it', () => {
    const projected = pickSharedCompanyContext({ legacyTone: 'friendly' });

    expect(projected.legacyTone).toBeUndefined();
  });
});

describe('mergeSharedCompanyContext', () => {
  it('a shared-field-only PATCH preserves qualification untouched', () => {
    const existing = {
      identity: { publicName: 'Acme' },
      service: { businessHours: 'Mon-Fri', handoffRules: 'transfer' },
      qualification: { conversionGoal: 'book_meeting' },
    };

    const merged = mergeSharedCompanyContext(existing, {
      identity: { summary: 'Updated summary' },
    });

    expect(merged.qualification).toEqual({ conversionGoal: 'book_meeting' });
  });

  it('updating identity.summary preserves identity.legalName and other identity fields', () => {
    const existing = {
      identity: {
        publicName: 'Acme',
        legalName: 'Acme Ltda',
        summary: 'Old summary',
      },
    };

    const merged = mergeSharedCompanyContext(existing, {
      identity: { summary: 'New summary' },
    });

    expect(merged.identity).toEqual({
      publicName: 'Acme',
      legalName: 'Acme Ltda',
      summary: 'New summary',
    });
  });

  it('updating service.businessHours preserves the other LeadFlow-only service fields', () => {
    const existing = {
      service: {
        businessHours: 'Mon-Fri 9-18',
        handoffRules: 'transfer if angry',
        serviceLevel: '24h SLA',
        emergencyRules: 'call the on-call line',
        unsupportedRequests: 'refunds after 90 days',
      },
    };

    const merged = mergeSharedCompanyContext(existing, {
      service: { businessHours: 'Mon-Sat 8-20' },
    });

    expect(merged.service).toEqual({
      businessHours: 'Mon-Sat 8-20',
      handoffRules: 'transfer if angry',
      serviceLevel: '24h SLA',
      emergencyRules: 'call the on-call line',
      unsupportedRequests: 'refunds after 90 days',
    });
  });

  it('an incoming qualification field is silently ignored, never merged in', () => {
    const existing = {
      qualification: { conversionGoal: 'book_meeting' },
    };

    const merged = mergeSharedCompanyContext(existing, {
      // A caller attempting to smuggle a qualification change through the
      // Platform DTO must not be able to change it.
      qualification: { conversionGoal: 'buy_now' },
    } as never);

    expect(merged.qualification).toEqual({ conversionGoal: 'book_meeting' });
  });

  it('an incoming service.handoffRules field is silently ignored, never merged in', () => {
    const existing = {
      service: { businessHours: 'Mon-Fri', handoffRules: 'transfer if angry' },
    };

    const merged = mergeSharedCompanyContext(existing, {
      service: { handoffRules: 'never transfer', businessHours: 'Mon-Fri' },
    });

    expect((merged.service as Record<string, unknown>).handoffRules).toBe(
      'transfer if angry',
    );
  });

  it('the exact documented scenario: identity.summary changes, handoffRules and qualification survive', () => {
    const existing = {
      identity: { publicName: 'Acme', summary: 'Old' },
      service: {
        businessHours: ['Mon-Fri 9-18'],
        handoffRules: { escalateOnAnger: true },
      },
      qualification: { conversionGoal: 'book_meeting' },
    };

    const merged = mergeSharedCompanyContext(existing, {
      identity: { summary: 'New' },
    });

    expect(merged.identity).toEqual({ publicName: 'Acme', summary: 'New' });
    expect(merged.service).toEqual({
      businessHours: ['Mon-Fri 9-18'],
      handoffRules: { escalateOnAnger: true },
    });
    expect(merged.qualification).toEqual({ conversionGoal: 'book_meeting' });
  });

  it('an omitted field in the PATCH body leaves the existing shared value untouched', () => {
    const existing = {
      offers: ['A', 'B'],
      policies: 'no refunds',
    };

    const merged = mergeSharedCompanyContext(existing, {
      identity: { summary: 'New summary' },
    });

    expect(merged.offers).toEqual(['A', 'B']);
    expect(merged.policies).toBe('no refunds');
  });

  it('partially updates contact without losing its omitted fields or LeadFlow-only data', () => {
    const existing = {
      identity: { publicName: 'Acme' },
      contact: {
        website: 'https://old.example.com',
        phone: '123',
        socialProfiles: [
          { network: 'instagram', url: 'https://instagram.com/acme' },
        ],
        address: {
          line1: 'Rua Antiga, 1',
          city: 'São Paulo',
          stateRegion: 'SP',
          country: 'BR',
        },
      },
      qualification: { conversionGoal: 'book_meeting' },
      service: {
        businessHours: 'Mon-Fri',
        handoffRules: 'transfer',
        serviceLevel: '24h',
        emergencyRules: 'call',
        unsupportedRequests: 'refunds',
      },
    };

    const merged = mergeSharedCompanyContext(existing, {
      contact: {
        website: 'https://new.example.com',
        address: { city: 'Campinas' },
      },
    });

    expect(merged.contact).toEqual({
      website: 'https://new.example.com',
      phone: '123',
      socialProfiles: [
        { network: 'instagram', url: 'https://instagram.com/acme' },
      ],
      address: {
        line1: 'Rua Antiga, 1',
        city: 'Campinas',
        stateRegion: 'SP',
        country: 'BR',
      },
    });
    expect(merged.qualification).toEqual({ conversionGoal: 'book_meeting' });
    expect(merged.service).toEqual(existing.service);
  });

  it('replaces socialProfiles as a list when it is explicitly patched', () => {
    const merged = mergeSharedCompanyContext(
      {
        contact: {
          phone: '123',
          socialProfiles: [{ network: 'instagram', handle: '@old' }],
        },
      },
      {
        contact: {
          socialProfiles: [
            { network: 'linkedin', url: 'https://linkedin.com' },
          ],
        },
      },
    );

    expect(merged.contact).toEqual({
      phone: '123',
      socialProfiles: [{ network: 'linkedin', url: 'https://linkedin.com' }],
    });
  });
});
