import { FindOperator } from 'typeorm';
import {
  durableMediaAssetSource,
  isTemporaryMediaAssetSource,
  temporaryMediaAssetSource,
} from './media-asset-retention';

describe('media asset retention marker', () => {
  it('prefixes a provenance and recognizes it back', () => {
    const source = temporaryMediaAssetSource('creative_generation');

    expect(source).toBe('temporary:creative_generation');
    expect(isTemporaryMediaAssetSource(source)).toBe(true);
    expect(isTemporaryMediaAssetSource('creative_studio')).toBe(false);
    expect(isTemporaryMediaAssetSource('planner_upload')).toBe(false);
  });

  it.each(['', 'Creative', 'temporary:x', 'a%b', 'a_b%'])(
    'refuses a malformed provenance: %p',
    (provenance) => {
      expect(() => temporaryMediaAssetSource(provenance)).toThrow();
    },
  );

  it('filters durable assets as NOT LIKE the prefix', () => {
    const operator = durableMediaAssetSource();

    expect(operator).toBeInstanceOf(FindOperator);
    expect(operator.type).toBe('not');
    const inner = operator.child as FindOperator<string>;
    expect(inner.type).toBe('like');
    expect(inner.value).toBe('temporary:%');
  });
});
