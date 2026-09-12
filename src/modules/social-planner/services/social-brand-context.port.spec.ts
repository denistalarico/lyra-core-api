import { toBrandContext } from './social-brand-context.port';

describe('toBrandContext', () => {
  const fullContext = {
    identity: {
      publicName: 'Clínica Aurora',
      legalName: 'Aurora Saúde LTDA',
      summary: 'Clínica de estética avançada',
      valueProposition: 'Protocolos personalizados',
      differentiators: 'Equipe médica própria',
      targetAudience: 'Mulheres de 30 a 55 anos',
      regionsServed: 'Grande São Paulo',
    },
    contact: {
      phone: '+55 11 99999-0000',
      email: 'contato@aurora.example',
      whatsapp: '+55 11 98888-0000',
      website: 'https://aurora.example',
      address: {
        line1: 'Rua das Acácias, 100',
        line2: 'Sala 42',
        postalCode: '01310-000',
        city: 'São Paulo',
        stateRegion: 'SP',
        country: 'BR',
      },
    },
    qualification: {
      priorityServices: 'Limpeza de pele e botox',
      preferredCta: 'Agende sua avaliação',
      conversionGoal: 'Agendamento',
    },
    policies: 'Cancelamento com 24h de antecedência',
  };

  it('projects the editorial fields', () => {
    const brand = toBrandContext(fullContext, 'clinics_esthetics');

    expect(brand.publicName).toBe('Clínica Aurora');
    expect(brand.valueProposition).toBe('Protocolos personalizados');
    expect(brand.mainOffers).toBe('Limpeza de pele e botox');
    expect(brand.businessMode).toBe('clinics_esthetics');
  });

  /**
   * The point of the port: contact details are in the same blob as the brand
   * facts, and nothing but this projection stops them reaching a paid provider.
   */
  it('never carries contact details into the prompt', () => {
    const brand = toBrandContext(fullContext, null);
    const serialized = JSON.stringify(brand);

    expect(serialized).not.toContain('99999-0000');
    expect(serialized).not.toContain('contato@aurora.example');
    expect(serialized).not.toContain('98888-0000');
    expect(serialized).not.toContain('aurora.example');
    expect(serialized).not.toContain('Rua das Acácias');
    expect(serialized).not.toContain('Sala 42');
    expect(serialized).not.toContain('01310-000');
  });

  it('keeps the coarse location, which changes what is seasonally relevant', () => {
    const brand = toBrandContext(fullContext, null);

    expect(brand.city).toBe('São Paulo');
    expect(brand.stateRegion).toBe('SP');
    expect(brand.country).toBe('BR');
  });

  it('accepts only a clean ISO alpha-2 country', () => {
    const from = (country: unknown) =>
      toBrandContext({ contact: { address: { country } } }, null).country;

    expect(from('br')).toBe('BR');
    expect(from(' Br ')).toBe('BR');
    // Free-text values written before the ISO selector existed.
    expect(from('Brasil')).toBeNull();
    expect(from('United States')).toBeNull();
    expect(from('')).toBeNull();
    expect(from(42)).toBeNull();
  });

  it('survives a missing or malformed context without throwing', () => {
    expect(toBrandContext({}, null).publicName).toBeNull();
    expect(toBrandContext({ identity: 'nope' }, null).publicName).toBeNull();
    expect(toBrandContext({ contact: [] }, null).country).toBeNull();
  });

  it('caps a single field so it cannot dominate the prompt budget', () => {
    const brand = toBrandContext(
      { identity: { summary: 'x'.repeat(10_000) } },
      null,
    );

    expect(brand.summary).toHaveLength(1_500);
  });

  it('treats a blank business mode as unset', () => {
    expect(toBrandContext({}, '   ').businessMode).toBeNull();
    expect(toBrandContext({}, null).businessMode).toBeNull();
  });
});
