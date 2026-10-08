import {
  derivedImageRequestFingerprint,
  imageRequestFingerprint,
} from './creative-image-generation.service';
import { referencesDigest } from './creative-generation-references';

/** CS3.6.2 — the identity of a derived intent (`image.v4`). */
describe('derived request fingerprint (CS3.6.2)', () => {
  const ref = (assetId: string, checksum: string, source = 'operator') => ({
    source: source as 'operator',
    assetId,
    kind: source === 'base' ? 'base' : 'style',
    checksum,
  });
  const BASE = ref(
    'b0000000-0000-4000-8000-000000000001',
    'a'.repeat(64),
    'base',
  );
  const P = ref('c0000000-0000-4000-8000-000000000001', 'b'.repeat(64));
  const request = {
    prompt: 'troque o fundo',
    contentItemId: null,
    outputCount: 1,
    aspectRatio: '1:1' as const,
    quality: 'standard' as const,
    contextDigest: 'c'.repeat(64),
    referencesDigest: referencesDigest([BASE, P]),
  };
  const output = {
    type: 'variation' as const,
    outputId: 'd0000000-0000-4000-8000-000000000001',
  };
  const fp = (
    patch: Partial<Parameters<typeof derivedImageRequestFingerprint>[0]> = {},
  ) => derivedImageRequestFingerprint({ ...request, origin: output, ...patch });

  it('is stable and case-insensitive on ids', () => {
    expect(fp()).toBe(fp());
    expect(
      fp({ origin: { ...output, outputId: output.outputId.toUpperCase() } }),
    ).toBe(fp());
  });

  it('never matches a fresh (image.v3) request with the same fields', () => {
    expect(fp()).not.toBe(imageRequestFingerprint(request));
  });

  it('changes with the mode, the origin, the base bytes, the order and the settings', () => {
    const variants = [
      fp({ origin: { type: 'regeneration', generationId: output.outputId } }),
      fp({ origin: { type: 'variation', versionId: output.outputId } }),
      fp({
        origin: { ...output, outputId: 'e0000000-0000-4000-8000-000000000001' },
      }),
      fp({
        referencesDigest: referencesDigest([
          { ...BASE, checksum: 'f'.repeat(64) },
          P,
        ]),
      }),
      fp({ referencesDigest: referencesDigest([P, BASE]) }),
      // The same image as base vs. as an ordinary reference.
      fp({
        referencesDigest: referencesDigest([
          ref(BASE.assetId, BASE.checksum),
          P,
        ]),
      }),
      fp({ prompt: 'troque a luz' }),
      fp({ quality: 'high' }),
      fp({ outputCount: 2 }),
    ];
    expect(new Set([fp(), ...variants]).size).toBe(variants.length + 1);
  });
});
