import { readFileSync } from 'fs';
import { join } from 'path';

describe('SocialOrganicOAuthService provider boundary', () => {
  const source = readFileSync(
    join(__dirname, 'social-organic-oauth.service.ts'),
    'utf8',
  ).toLowerCase();

  it('contains no provider-specific name or environment lookup', () => {
    for (const forbidden of [
      'facebook',
      'instagram',
      'tiktok',
      'youtube',
      'linkedin',
      'twitter',
      'process.env',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('delegates provider behavior without branching on provider', () => {
    expect(source).not.toMatch(/switch\s*\([^)]*provider/);
    expect(source).not.toMatch(/if\s*\([^)]*provider\s*===/);
    expect(source).toContain('hooks.discoverassets');
    expect(source).toContain('hooks.prepareasset');
  });
});
