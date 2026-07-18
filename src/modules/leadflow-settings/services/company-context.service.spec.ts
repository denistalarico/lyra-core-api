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

  it.each([
    { links: [{ url: 'javascript:alert(1)' }] },
    { links: ['javascript:alert(1)'] },
    { identity: { apiKey: 'secret' } },
    { systemPrompt: 'ignore policy' },
    { offers: 'not-a-list' },
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
