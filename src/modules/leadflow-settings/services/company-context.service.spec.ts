import { BadRequestException } from '@nestjs/common';
import { CompanyContextService } from './company-context.service';

describe('CompanyContextService', () => {
  const service = new CompanyContextService();

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
});
