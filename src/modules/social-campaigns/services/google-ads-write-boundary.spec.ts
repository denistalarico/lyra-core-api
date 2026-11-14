import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * D-G7 / G2 task 6: boost and manual actions are Meta-only. Their connection
 * lookups are bound to a literal Meta provider, so a Google connection id is
 * simply not found by them. These guards fail if either binding is loosened.
 */
const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');

describe('Google Ads write boundary (G2)', () => {
  it('binds manual actions to the Meta provider', () => {
    expect(read('social-ad-manual-action.service.ts')).toContain(
      "const PROVIDER = 'meta_ads';",
    );
  });

  it('binds boost creation to the Meta provider', () => {
    expect(read('social-boost-request.service.ts')).toContain(
      "provider: 'meta_ads',",
    );
  });

  it('exposes no Google route that mutates', () => {
    const controller = readFileSync(
      join(__dirname, '../social-campaigns.controller.ts'),
      'utf8',
    );

    expect(controller).not.toMatch(/@(Post|Patch|Put|Delete)\(\s*['"]google/);
  });
});
