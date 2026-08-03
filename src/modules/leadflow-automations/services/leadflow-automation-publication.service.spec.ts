import { ConflictException } from '@nestjs/common';
import { assertExpectedPublicationVersion } from './leadflow-automation.service';

describe('automation publication review version', () => {
  it('accepts the reviewed version and the first publication', () => {
    expect(() => assertExpectedPublicationVersion(0, 0)).not.toThrow();
    expect(() => assertExpectedPublicationVersion(undefined, 4)).not.toThrow();
  });

  it('rejects a stale reviewed version before a new snapshot is created', () => {
    try {
      assertExpectedPublicationVersion(2, 3);
      fail('expected publication conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'AUTOMATION_PUBLICATION_VERSION_CONFLICT',
        expectedVersion: 2,
        currentVersion: 3,
      });
    }
  });
});
