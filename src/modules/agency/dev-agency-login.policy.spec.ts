import { isDevOnlyAgencyLoginBlocked } from './dev-agency-login.policy';

describe('isDevOnlyAgencyLoginBlocked', () => {
  it('rejects the reserved dev-only address in production', () => {
    expect(
      isDevOnlyAgencyLoginBlocked('SOCIAL-DEV@EXAMPLE.TEST', 'production'),
    ).toBe(true);
  });

  it('allows the reserved dev-only address outside production', () => {
    expect(
      isDevOnlyAgencyLoginBlocked('social-dev@example.test', 'development'),
    ).toBe(false);
  });

  it('does not block regular production identities', () => {
    expect(
      isDevOnlyAgencyLoginBlocked('person@example.com', 'production'),
    ).toBe(false);
  });
});
