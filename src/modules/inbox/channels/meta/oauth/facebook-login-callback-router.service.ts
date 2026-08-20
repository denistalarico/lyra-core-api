import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InboxChannelConnectionSessionEntity } from '../../../entities/inbox-channel-connection-session.entity';
import { FacebookMessengerOAuthService } from '../../facebook-messenger/oauth/facebook/facebook-messenger-oauth.service';
import { FacebookInstagramOAuthService } from '../../instagram/oauth/facebook/facebook-instagram-oauth.service';
import {
  hashFacebookOAuthState,
  isAcceptableFacebookOAuthState,
  type FacebookLoginCallbackInput,
} from './facebook-login-oauth.support';

/**
 * Facebook Login for Business redirects back to a single whitelisted URI
 * (META_FACEBOOK_OAUTH_CALLBACK_URL), shared by every Meta channel that
 * authorizes through the same Meta App. This router peeks at the connection
 * session behind the returned state and hands the callback to the owning
 * channel flow. Anything it cannot classify falls back to Instagram, whose own
 * lifecycle checks still reject it as `invalid_state`.
 */
@Injectable()
export class FacebookLoginCallbackRouterService {
  constructor(
    @InjectRepository(InboxChannelConnectionSessionEntity, 'agency')
    private readonly sessionsRepository: Repository<InboxChannelConnectionSessionEntity>,
    private readonly instagramOAuthService: FacebookInstagramOAuthService,
    private readonly messengerOAuthService: FacebookMessengerOAuthService,
  ) {}

  async handleCallback(input: FacebookLoginCallbackInput) {
    const channelType = await this.resolveChannelType(input.state);

    if (channelType === 'facebook_messenger') {
      return this.messengerOAuthService.handleCallback(input);
    }

    return this.instagramOAuthService.handleCallback(input);
  }

  private async resolveChannelType(state: string | undefined) {
    if (!isAcceptableFacebookOAuthState(state)) {
      return null;
    }

    try {
      const session = await this.sessionsRepository.findOne({
        where: {
          state: hashFacebookOAuthState(state),
          provider: 'meta',
        },
        select: { id: true, channelType: true },
      });

      return session?.channelType ?? null;
    } catch {
      return null;
    }
  }
}
