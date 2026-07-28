import { AdminInvitationTokenService } from './admin-invitation-token.service';

describe('AdminInvitationTokenService', () => {
  const service = new AdminInvitationTokenService();

  it('creates opaque one-time material and persists only a deterministic hash', () => {
    const first = service.create();
    const second = service.create();

    expect(first.token).not.toEqual(first.hash);
    expect(first.hash).toHaveLength(64);
    expect(service.hash(first.token)).toEqual(first.hash);
    expect(second.token).not.toEqual(first.token);
    expect(second.hash).not.toEqual(first.hash);
  });
});
