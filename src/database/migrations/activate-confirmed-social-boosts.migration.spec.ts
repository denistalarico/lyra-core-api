import { ActivateConfirmedSocialBoosts1794000000000 } from './1794000000000-activate-confirmed-social-boosts';

describe('ActivateConfirmedSocialBoosts1794000000000', () => {
  it('permits the audited active completion state', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new ActivateConfirmedSocialBoosts1794000000000().up({ query } as never);

    expect(query.mock.calls.flat().join('\n')).toContain("'created_active'");
  });
});
