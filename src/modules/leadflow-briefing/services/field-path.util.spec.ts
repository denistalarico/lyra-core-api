import {
  getAtFieldPath,
  isValidFieldPath,
  parseFieldPath,
  setAtFieldPath,
} from './field-path.util';

describe('field-path.util', () => {
  describe('parseFieldPath', () => {
    it('parses a dotted path', () => {
      expect(parseFieldPath('identity.publicName')).toEqual([
        { key: 'identity', index: null },
        { key: 'publicName', index: null },
      ]);
    });

    it('parses a bracket-indexed path', () => {
      expect(parseFieldPath('offers[2].title')).toEqual([
        { key: 'offers', index: 2 },
        { key: 'title', index: null },
      ]);
    });

    it('rejects a malformed segment', () => {
      expect(() => parseFieldPath('offers[2.title')).toThrow();
      expect(() => parseFieldPath('')).toThrow();
    });
  });

  describe('isValidFieldPath', () => {
    it('accepts a path rooted at a known company-context section', () => {
      expect(isValidFieldPath('identity.publicName')).toBe(true);
      expect(isValidFieldPath('offers[0].title')).toBe(true);
      expect(isValidFieldPath('contact.website')).toBe(true);
      expect(isValidFieldPath('contact.socialProfiles[0].url')).toBe(true);
    });

    it('rejects a path outside the canonical root schema', () => {
      expect(isValidFieldPath('unknownSection.field')).toBe(false);
    });

    it('rejects a forbidden/secret-like segment', () => {
      expect(isValidFieldPath('identity.apiKey')).toBe(false);
      expect(isValidFieldPath('service.systemPrompt')).toBe(false);
    });

    it('rejects a malformed path without throwing', () => {
      expect(isValidFieldPath('offers[2.title')).toBe(false);
    });
  });

  describe('getAtFieldPath / setAtFieldPath', () => {
    it('round-trips a dotted path', () => {
      const draft = { identity: { publicName: 'Old Name' } };
      const updated = setAtFieldPath(draft, 'identity.publicName', 'New Name');
      expect(getAtFieldPath(updated, 'identity.publicName')).toBe('New Name');
    });

    it('round-trips a bracket-indexed path', () => {
      const draft = { offers: [{ title: 'A' }, { title: 'B' }] };
      const updated = setAtFieldPath(draft, 'offers[1].title', 'B2');
      expect(getAtFieldPath(updated, 'offers[1].title')).toBe('B2');
      expect(getAtFieldPath(updated, 'offers[0].title')).toBe('A');
    });

    it('does not mutate the input draft', () => {
      const draft = { identity: { publicName: 'Old' } };
      setAtFieldPath(draft, 'identity.publicName', 'New');
      expect(draft.identity.publicName).toBe('Old');
    });

    it('leaves sibling fields untouched when setting one field', () => {
      const draft = {
        identity: { publicName: 'A', summary: 'Keep me' },
        offers: ['Offer 1'],
      };
      const updated = setAtFieldPath(draft, 'identity.publicName', 'A2');
      expect(getAtFieldPath(updated, 'identity.summary')).toBe('Keep me');
      expect(getAtFieldPath(updated, 'offers')).toEqual(['Offer 1']);
    });

    it('returns undefined when reading through a missing branch', () => {
      expect(getAtFieldPath({}, 'identity.publicName')).toBeUndefined();
    });
  });
});
