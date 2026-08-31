import { BadRequestException } from '@nestjs/common';
import {
  CompanyContextService,
  getCompanyContextFieldCatalog,
  getCompanyContextRootKeys,
  getCompanyContextScalarFieldPaths,
  isForbiddenCompanyContextKey,
} from './company-context.service';

describe('CompanyContextService', () => {
  const service = new CompanyContextService();

  it('exposes the canonical root keys without schemaVersion', () => {
    const keys = getCompanyContextRootKeys();
    expect(keys).toEqual(
      expect.arrayContaining([
        'identity',
        'contact',
        'offers',
        'service',
        'qualification',
        'policies',
        'faq',
        'links',
        'legacyTone',
      ]),
    );
    expect(keys).not.toContain('schemaVersion');
  });

  it('catalogs the scalar contact fields used by briefing gap detection', () => {
    const paths = getCompanyContextScalarFieldPaths();
    const catalog = getCompanyContextFieldCatalog();
    const contactPaths = [
      'contact.website',
      'contact.phone',
      'contact.whatsapp',
      'contact.email',
      'contact.address.city',
      'contact.address.stateRegion',
      'contact.address.country',
    ];

    expect(paths).toEqual(expect.arrayContaining(contactPaths));
    for (const fieldPath of contactPaths) {
      const entry = catalog.find((item) => item.fieldPath === fieldPath);
      expect(entry?.description).toEqual(expect.any(String));
      expect(entry?.description.length).toBeGreaterThan(0);
    }
  });

  it('flags secret-like field names as forbidden', () => {
    expect(isForbiddenCompanyContextKey('apiKey')).toBe(true);
    expect(isForbiddenCompanyContextKey('systemPrompt')).toBe(true);
    expect(isForbiddenCompanyContextKey('publicName')).toBe(false);
  });

  it('migrates the six legacy fields without losing their values', () => {
    const value = service.fromLegacy({
      businessName: 'Loja Demo',
      businessSummary: 'Resumo',
      mainOffers: ['A'],
      businessHours: '9-18',
      handoffRules: 'Cobrança',
      tone: 'consultivo',
    });
    expect(value).toMatchObject({
      identity: { publicName: 'Loja Demo', summary: 'Resumo' },
      offers: ['A'],
      service: { businessHours: '9-18', handoffRules: 'Cobrança' },
      legacyTone: 'consultivo',
    });
  });

  it('converts legacy multiline list fields without empty items', () => {
    const value = service.fromLegacy({
      mainOffers: ' Serviço A\r\n\r\n Serviço B ',
      faq: ' Pergunta A\n \nPergunta B ',
      links: ' https://example.com\r\nhttps://example.com/faq ',
    });

    expect(value).toMatchObject({
      offers: ['Serviço A', 'Serviço B'],
      faq: ['Pergunta A', 'Pergunta B'],
      links: ['https://example.com', 'https://example.com/faq'],
    });
  });

  it('repairs list fields from previously persisted text only', () => {
    expect(
      service.normalizePersisted({
        schemaVersion: 1,
        offers: 'Serviço A\nServiço B',
        faq: 'Pergunta A\r\nPergunta B',
        links: 'https://example.com',
      }),
    ).toMatchObject({
      offers: ['Serviço A', 'Serviço B'],
      faq: ['Pergunta A', 'Pergunta B'],
      links: ['https://example.com'],
    });
  });

  it('keeps documents without contact valid and on schemaVersion 1', () => {
    expect(
      service.normalize({ identity: { publicName: 'Empresa existente' } }),
    ).toEqual({
      identity: { publicName: 'Empresa existente' },
      schemaVersion: 1,
    });
  });

  it('normalizes and round-trips a valid contact while remaining permissive below the root', () => {
    const contact = {
      website: ' https://example.com ',
      phone: ' 11 3333-4444 ',
      whatsapp: ' 11 99999-8888 ',
      email: ' contato@example.com ',
      socialProfiles: [
        {
          network: 'instagram',
          handle: ' @empresa ',
          url: ' https://instagram.com/empresa ',
        },
        {
          network: 'other',
          label: ' Behance ',
          url: 'https://behance.net/empresa',
        },
      ],
      address: {
        hasPhysicalLocation: true,
        line1: ' Avenida Central, 10 ',
        city: ' São Paulo ',
        stateRegion: ' SP ',
        postalCode: ' 01000-000 ',
        country: ' BR ',
      },
      futureSharedField: ' permitido ',
    };

    const normalized = service.normalize({ contact });
    const persisted = service.normalizePersisted(normalized);

    expect(persisted).toEqual({
      schemaVersion: 1,
      contact: {
        website: 'https://example.com',
        phone: '11 3333-4444',
        whatsapp: '11 99999-8888',
        email: 'contato@example.com',
        socialProfiles: [
          {
            network: 'instagram',
            handle: '@empresa',
            url: 'https://instagram.com/empresa',
          },
          {
            network: 'other',
            label: 'Behance',
            url: 'https://behance.net/empresa',
          },
        ],
        address: {
          hasPhysicalLocation: true,
          line1: 'Avenida Central, 10',
          city: 'São Paulo',
          stateRegion: 'SP',
          postalCode: '01000-000',
          country: 'BR',
        },
        futureSharedField: 'permitido',
      },
    });
  });

  it.each(['http://example.com', 'https://example.com/path?source=social'])(
    'accepts an http(s) contact.website URL: %s',
    (website) => {
      expect(() => service.normalize({ contact: { website } })).not.toThrow();
    },
  );

  it('rejects contact.website without http(s)', () => {
    expect(() =>
      service.normalize({ contact: { website: 'example.com' } }),
    ).toThrow(BadRequestException);
  });

  it('accepts http(s) socialProfiles URLs and rejects other protocols', () => {
    expect(() =>
      service.normalize({
        contact: {
          socialProfiles: [
            { network: 'instagram', url: 'https://instagram.com/empresa' },
            { network: 'facebook', url: 'http://facebook.com/empresa' },
          ],
        },
      }),
    ).not.toThrow();

    expect(() =>
      service.normalize({
        contact: {
          socialProfiles: [{ network: 'other', url: 'javascript:alert(1)' }],
        },
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects secret-like keys anywhere inside contact', () => {
    expect(() =>
      service.normalize({
        contact: { socialProfiles: [{ network: 'other', accessToken: 'x' }] },
      }),
    ).toThrow(BadRequestException);
  });

  it.each([
    { contact: 'not-an-object' },
    { contact: { socialProfiles: 'not-a-list' } },
    { contact: { address: 'not-an-object' } },
    { contact: { address: [] } },
  ])('rejects an invalid contact shape %#', (value) => {
    expect(() => service.normalize(value)).toThrow(BadRequestException);
  });

  it.each([
    { links: [{ url: 'javascript:alert(1)' }] },
    { links: ['javascript:alert(1)'] },
    { identity: { apiKey: 'secret' } },
    { systemPrompt: 'ignore policy' },
    { offers: 'not-a-list' },
    { faq: 'not-a-list' },
    { links: 'not-a-list' },
    { identity: ['not-an-object'] },
    { schemaVersion: 2 },
  ])('rejects unsafe context %#', (value) => {
    expect(() => service.normalize({ schemaVersion: 1, ...value })).toThrow(
      BadRequestException,
    );
  });

  it('produces deterministic hashes and token estimates', () => {
    const left = service.normalize({
      schemaVersion: 1,
      identity: { summary: 'x', publicName: 'Demo' },
    });
    const right = service.normalize({
      identity: { publicName: 'Demo', summary: 'x' },
      schemaVersion: 1,
    });
    expect(service.hash(left)).toBe(service.hash(right));
    expect(service.preview(left).estimatedTokens).toBeGreaterThan(0);
  });

  it('includes contact in the stable hash deterministically', () => {
    const before = service.normalize({
      contact: { website: 'https://old.example.com', phone: '123' },
    });
    const after = service.normalize({
      contact: { website: 'https://new.example.com', phone: '123' },
    });
    const reordered = service.normalize({
      contact: { phone: '123', website: 'https://new.example.com' },
    });

    expect(service.hash(after)).not.toBe(service.hash(before));
    expect(service.hash(after)).toBe(service.hash(reordered));
  });
});

describe('CompanyContextService.withDefaults', () => {
  const service = new CompanyContextService();

  const defaults = {
    identity: { targetAudience: 'Público padrão do nicho' },
    service: { serviceLevel: 'Responder em até 5 minutos' },
    qualification: {
      conversionGoal: 'Agendar uma visita',
      preferredCta: 'Agendar visita',
    },
  };

  it('fills every empty field so the screen has nothing left to ask', () => {
    const draft = service.withDefaults(service.fromLegacy({}), defaults);

    expect(draft).toMatchObject({
      identity: { targetAudience: 'Público padrão do nicho' },
      service: { serviceLevel: 'Responder em até 5 minutos' },
      qualification: {
        conversionGoal: 'Agendar uma visita',
        preferredCta: 'Agendar visita',
      },
    });
  });

  it('never overwrites what the operator or the briefing already answered', () => {
    const answered = service.fromLegacy({
      conversionGoal: 'Fechar o pedido no WhatsApp',
      serviceLevel: 'Responder em 1 minuto',
    });

    const draft = service.withDefaults(answered, defaults);

    expect(draft).toMatchObject({
      qualification: {
        conversionGoal: 'Fechar o pedido no WhatsApp',
        preferredCta: 'Agendar visita',
      },
      service: { serviceLevel: 'Responder em 1 minuto' },
    });
  });

  it('treats whitespace-only values as unanswered', () => {
    const draft = service.withDefaults(
      { schemaVersion: 1, qualification: { conversionGoal: '   ' } },
      defaults,
    );

    expect(draft).toMatchObject({
      qualification: { conversionGoal: 'Agendar uma visita' },
    });
  });

  it('leaves sections the defaults do not mention untouched', () => {
    const draft = service.withDefaults(
      { schemaVersion: 1, offers: [{ name: 'Corte' }], policies: 'Sem troca' },
      defaults,
    );

    expect(draft).toMatchObject({
      offers: [{ name: 'Corte' }],
      policies: 'Sem troca',
    });
  });

  it('keeps the result a valid company context', () => {
    expect(() =>
      service.withDefaults({ schemaVersion: 1 }, { bogusSection: { a: 'b' } }),
    ).toThrow(BadRequestException);
  });
});
