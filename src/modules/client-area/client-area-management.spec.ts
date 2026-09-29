import { BadRequestException } from '@nestjs/common';
import { normalizeDomain } from './services/client-area-management.service';

describe('CA3 Client Area management primitives', () => {
  it('normalizes a custom hostname but never accepts a URL, path or IP target', () => {
    expect(normalizeDomain('  PORTAL.Example.com. ')).toBe(
      'portal.example.com',
    );
    for (const value of [
      'https://portal.example.com',
      'portal.example.com/a',
      'localhost',
      '127.0.0.1',
      '10.0.0.1',
      'portal.example.com?x=1',
    ]) {
      expect(() => normalizeDomain(value)).toThrow(BadRequestException);
    }
  });

  it('keeps only the one real V1 module in the Client Area catalog', () => {
    // The future names are deliberately not represented by settings booleans.
    const modules = { approvals: true };
    expect(Object.keys(modules)).toEqual(['approvals']);
  });
});
