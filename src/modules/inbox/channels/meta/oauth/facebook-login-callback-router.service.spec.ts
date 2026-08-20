/* eslint-disable @typescript-eslint/require-await -- Jest/TypeORM test doubles intentionally expose partial dynamic repository shapes. */
import { createHash } from 'crypto';
import type { Repository } from 'typeorm';
import type { InboxChannelConnectionSessionEntity } from '../../../entities/inbox-channel-connection-session.entity';
import type { FacebookMessengerOAuthService } from '../../facebook-messenger/oauth/facebook/facebook-messenger-oauth.service';
import type { FacebookInstagramOAuthService } from '../../instagram/oauth/facebook/facebook-instagram-oauth.service';
import { FacebookLoginCallbackRouterService } from './facebook-login-callback-router.service';

describe('FacebookLoginCallbackRouterService', () => {
  it('routes a Messenger session to the Messenger flow only', async () => {
    const harness = createHarness({ channelType: 'facebook_messenger' });

    await expect(
      harness.router.handleCallback({ state: 'valid-state', code: 'code' }),
    ).resolves.toBe('https://leadflow.example.com/messenger');

    expect(harness.sessions.findOne).toHaveBeenCalledWith({
      where: {
        state: hash('valid-state'),
        provider: 'meta',
      },
      select: { id: true, channelType: true },
    });
    expect(harness.messenger.handleCallback).toHaveBeenCalledWith({
      state: 'valid-state',
      code: 'code',
    });
    expect(harness.instagram.handleCallback).not.toHaveBeenCalled();
  });

  it('routes an Instagram session to the Instagram flow only', async () => {
    const harness = createHarness({ channelType: 'instagram' });

    await expect(
      harness.router.handleCallback({ state: 'valid-state', code: 'code' }),
    ).resolves.toBe('https://leadflow.example.com/instagram');

    expect(harness.instagram.handleCallback).toHaveBeenCalledWith({
      state: 'valid-state',
      code: 'code',
    });
    expect(harness.messenger.handleCallback).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown state', { session: null }],
    ['missing state', { state: undefined }],
    ['oversized state', { state: 'x'.repeat(513) }],
    ['lookup failure', { lookupFails: true }],
  ] as const)(
    'falls back to the Instagram flow for %s',
    async (_case, override) => {
      const harness = createHarness({
        channelType: 'facebook_messenger',
        ...('session' in override ? { session: override.session } : {}),
        ...('lookupFails' in override
          ? { lookupFails: override.lookupFails }
          : {}),
      });

      await harness.router.handleCallback({
        state: 'state' in override ? override.state : 'valid-state',
        code: 'code',
      });

      expect(harness.instagram.handleCallback).toHaveBeenCalledTimes(1);
      expect(harness.messenger.handleCallback).not.toHaveBeenCalled();
    },
  );

  it('never queries the provider or leaks the raw state', async () => {
    const harness = createHarness({ channelType: 'facebook_messenger' });

    await harness.router.handleCallback({
      state: 'valid-state',
      code: 'oauth-authorization-code',
    });

    const query = JSON.stringify(harness.sessions.findOne.mock.calls);
    expect(query).not.toContain('valid-state');
    expect(query).not.toContain('oauth-authorization-code');
  });
});

function createHarness(options: {
  channelType?: string;
  session?: Partial<InboxChannelConnectionSessionEntity> | null;
  lookupFails?: boolean;
}) {
  const session =
    options.session === undefined
      ? { id: 'session-id', channelType: options.channelType }
      : options.session;
  const sessions = {
    findOne: jest.fn(async () => {
      if (options.lookupFails) throw new Error('database unavailable');
      return session;
    }),
  };
  const instagram = {
    handleCallback: jest.fn(
      async () => 'https://leadflow.example.com/instagram',
    ),
  };
  const messenger = {
    handleCallback: jest.fn(
      async () => 'https://leadflow.example.com/messenger',
    ),
  };

  return {
    router: new FacebookLoginCallbackRouterService(
      sessions as unknown as Repository<InboxChannelConnectionSessionEntity>,
      instagram as unknown as FacebookInstagramOAuthService,
      messenger as unknown as FacebookMessengerOAuthService,
    ),
    sessions,
    instagram,
    messenger,
  };
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
