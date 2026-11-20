import {
  metaLeadAttribution,
  normalizeMetaLead,
  parseMetaLead,
} from './meta-lead.normalizer';

// Fictional lead: no real data in fixtures.
const raw = (extra: Record<string, unknown> = {}) => ({
  id: '9001',
  created_time: '2026-11-20T08:49:14+0000',
  ad_id: '301',
  adset_id: '201',
  campaign_id: '101',
  form_id: '55',
  platform: 'fb',
  is_organic: false,
  field_data: [
    { name: 'full_name', values: ['Pessoa Fictícia'] },
    { name: 'email', values: ['lead.ficticio@example.com'] },
    { name: 'phone_number', values: ['+5511900000000'] },
    { name: 'qual_o_seu_orçamento?', values: ['Até 5 mil'] },
  ],
  ...extra,
});

describe('Meta lead normalizer (ML1)', () => {
  it('maps the standard questions to the contact', () => {
    const lead = parseMetaLead(raw(), '777');
    expect(normalizeMetaLead(lead!).lead).toEqual({
      name: 'Pessoa Fictícia',
      email: 'lead.ficticio@example.com',
      phone: '+5511900000000',
      company: null,
      position: null,
    });
  });

  it('keeps a custom question as a summary line', () => {
    const lead = parseMetaLead(raw(), '777');
    expect(normalizeMetaLead(lead!).summaryLines).toEqual([
      'Qual o seu orçamento: Até 5 mil',
    ]);
  });

  it('joins first and last name when there is no full name', () => {
    const lead = parseMetaLead(
      raw({
        field_data: [
          { name: 'first_name', values: ['Pessoa'] },
          { name: 'last_name', values: ['Fictícia'] },
        ],
      }),
    );
    expect(normalizeMetaLead(lead!).lead.name).toBe('Pessoa Fictícia');
  });

  it("reads Meta's +0000 offset as a real instant", () => {
    expect(parseMetaLead(raw())?.submittedAt).toBe('2026-11-20T08:49:14.000Z');
  });

  it('carries the ad hierarchy, the Page and the lead id in the attribution', () => {
    expect(metaLeadAttribution(parseMetaLead(raw(), '777')!)).toEqual({
      campaignId: '101',
      adSetId: '201',
      adId: '301',
      formId: '55',
      pageId: '777',
      leadId: '9001',
      platform: 'fb',
      submittedAt: '2026-11-20T08:49:14.000Z',
      isOrganic: 'false',
      isTest: 'false',
    });
  });

  it('recognizes a Lead Ads Testing Tool lead by its placeholder answers', () => {
    const lead = parseMetaLead(
      raw({
        field_data: [
          { name: 'email', values: ['<test lead: dummy data for email>'] },
          {
            name: 'full_name',
            values: ['<test lead: dummy data for full_name>'],
          },
        ],
      }),
    );
    expect(lead?.isTest).toBe(true);
  });

  it('refuses a lead without an id', () => {
    expect(parseMetaLead(raw({ id: undefined }))).toBeNull();
  });

  it('ignores unknown top-level fields and malformed answers', () => {
    const lead = parseMetaLead(
      raw({
        surprise: { nested: true },
        field_data: [{ name: 'email' }, 'x', { values: ['sem nome'] }],
      }),
    );
    expect(lead?.fields).toEqual([]);
  });
});
