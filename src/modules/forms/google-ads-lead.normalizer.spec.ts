import {
  GoogleAdsLeadFormatError,
  googleAdsExternalLeadId,
  googleAdsLeadAttribution,
  normalizeGoogleAdsLead,
  parseGoogleAdsLead,
} from './google-ads-lead.normalizer';

// Fictional data only (no real lead may be used as a fixture).
const body = {
  lead_id: 'lead-fixture-001',
  api_version: '1.0',
  form_id: 12345,
  campaign_id: 987654321,
  gcl_id: 'gclid-fixture',
  google_key: 'must-never-be-read',
  is_test: false,
  lead_submit_time: '2026-11-19T10:15:00-03:00',
  campo_novo_do_google: { qualquer: 'coisa' },
  user_column_data: [
    { column_id: 'FULL_NAME', string_value: 'Maria Teste' },
    { column_id: 'EMAIL', string_value: 'Maria.Teste@Example.com' },
    { column_id: 'PHONE_NUMBER', string_value: '+5511999990000' },
    { column_id: 'COMPANY_NAME', string_value: 'Empresa Fictícia' },
    { column_id: 'JOB_TITLE', string_value: 'Diretora' },
    { column_id: 'CITY', string_value: 'São Paulo' },
    {
      column_id: 'QUESTION_77',
      column_name: 'Qual o seu orçamento?',
      string_value: 'Até 5 mil',
    },
  ],
};

describe('google-ads-lead normalizer', () => {
  it('maps the standard columns to contact fields', () => {
    const { lead } = normalizeGoogleAdsLead(parseGoogleAdsLead(body));
    expect(lead).toEqual({
      name: 'Maria Teste',
      email: 'maria.teste@example.com',
      phone: '+5511999990000',
      company: 'Empresa Fictícia',
      position: 'Diretora',
    });
  });

  it('turns the other columns into summary lines with pt-BR labels', () => {
    const { summaryLines } = normalizeGoogleAdsLead(parseGoogleAdsLead(body));
    expect(summaryLines).toEqual([
      'Cidade: São Paulo',
      'Qual o seu orçamento?: Até 5 mil',
    ]);
  });

  it('joins FIRST_NAME and LAST_NAME and prefers FULL_NAME when both come', () => {
    const split = normalizeGoogleAdsLead(
      parseGoogleAdsLead({
        lead_id: 'x',
        user_column_data: [
          { column_id: 'FIRST_NAME', string_value: 'João' },
          { column_id: 'LAST_NAME', string_value: 'Fictício' },
        ],
      }),
    );
    expect(split.lead.name).toBe('João Fictício');
    const both = normalizeGoogleAdsLead(
      parseGoogleAdsLead({
        lead_id: 'x',
        user_column_data: [
          { column_id: 'FULL_NAME', string_value: 'Ana Completa' },
          { column_id: 'FIRST_NAME', string_value: 'Outra' },
        ],
      }),
    );
    expect(both.lead.name).toBe('Ana Completa');
    expect(both.summaryLines).toEqual([]);
  });

  it('falls back to WORK_EMAIL/WORK_PHONE and keeps the spare ones as summary', () => {
    const result = normalizeGoogleAdsLead(
      parseGoogleAdsLead({
        lead_id: 'x',
        user_column_data: [
          { column_id: 'EMAIL', string_value: 'não-é-email' },
          { column_id: 'WORK_EMAIL', string_value: 'work@example.com' },
          { column_id: 'WORK_PHONE', string_value: '+5511988880000' },
        ],
      }),
    );
    expect(result.lead.email).toBe('work@example.com');
    expect(result.lead.phone).toBe('+5511988880000');
    expect(result.summaryLines).toEqual(['E-mail: não-é-email']);
  });

  it('accepts column_value.string_value as well', () => {
    const result = normalizeGoogleAdsLead(
      parseGoogleAdsLead({
        lead_id: 'x',
        user_column_data: [
          { column_id: 'FULL_NAME', column_value: { string_value: 'Beto' } },
        ],
      }),
    );
    expect(result.lead.name).toBe('Beto');
  });

  it('ignores unknown fields and never carries google_key', () => {
    const parsed = parseGoogleAdsLead(body);
    expect(JSON.stringify(parsed)).not.toContain('must-never-be-read');
    expect(Object.keys(parsed)).not.toContain('campo_novo_do_google');
  });

  it('builds the attribution of the contract', () => {
    expect(googleAdsLeadAttribution(parseGoogleAdsLead(body))).toEqual({
      gclid: 'gclid-fixture',
      campaignId: '987654321',
      formId: '12345',
      leadId: 'lead-fixture-001',
      submittedAt: '2026-11-19T13:15:00.000Z',
      isTest: 'false',
    });
  });

  it('carries asset group and ad group when present', () => {
    const attribution = googleAdsLeadAttribution(
      parseGoogleAdsLead({
        lead_id: 'x',
        asset_group_id: 55,
        adgroup_id: '66',
        user_column_data: [],
      }),
    );
    expect(attribution).toMatchObject({ assetGroupId: '55', adGroupId: '66' });
  });

  it('keys test leads on their submit time and real leads on lead_id', () => {
    expect(googleAdsExternalLeadId(parseGoogleAdsLead(body))).toBe(
      'lead-fixture-001',
    );
    const test = parseGoogleAdsLead({
      ...body,
      is_test: true,
      lead_id: 'TEST',
    });
    expect(googleAdsExternalLeadId(test)).toBe(
      'test:TEST:2026-11-19T13:15:00.000Z',
    );
  });

  it.each([
    ['not an object', 'x'],
    ['no lead_id', { user_column_data: [] }],
    ['no columns array', { lead_id: 'x' }],
  ])('rejects a body with %s', (_label, input) => {
    expect(() => parseGoogleAdsLead(input)).toThrow(GoogleAdsLeadFormatError);
  });
});
