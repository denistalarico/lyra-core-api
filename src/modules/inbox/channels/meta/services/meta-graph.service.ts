import { BadRequestException, Injectable } from '@nestjs/common';

type ExchangeCodeResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

type SubscribeWabaResponse = {
  success?: boolean;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

type RegisterPhoneNumberResponse = {
  success?: boolean;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

type WhatsAppPhoneNumberResponse = {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  messaging_limit_tier?: string;
  platform_type?: string;
  code_verification_status?: string;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

type InstagramApiError = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
};

type InstagramShortLivedTokenPayload = {
  access_token?: string;
  user_id?: string | number;
  permissions?: string | string[];
};

type InstagramShortLivedTokenResponse = InstagramShortLivedTokenPayload & {
  data?: InstagramShortLivedTokenPayload[];
  error?: InstagramApiError;
};

type InstagramLongLivedTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: InstagramApiError;
};

type InstagramIdentityPayload = {
  id?: string | number;
  user_id?: string | number;
  username?: string;
};

type InstagramIdentityResponse = InstagramIdentityPayload & {
  data?: InstagramIdentityPayload[];
  error?: InstagramApiError;
};

type InstagramWebhookSubscriptionResponse = {
  success?: boolean;
  error?: InstagramApiError;
};

type InstagramWebhookSubscriptionsResponse = {
  data?: Array<{
    id?: string;
    subscribed_fields?: unknown;
  }>;
  error?: InstagramApiError;
};

type InstagramUserProfileResponse = {
  id?: string | number;
  name?: string | null;
  username?: string | null;
  profile_pic?: string | null;
  error?: InstagramApiError;
};

export const INSTAGRAM_MESSAGING_WEBHOOK_FIELDS = [
  'messages',
  'messaging_postbacks',
  'message_reactions',
  'messaging_seen',
] as const;

export type InstagramMessagingWebhookField =
  (typeof INSTAGRAM_MESSAGING_WEBHOOK_FIELDS)[number];

@Injectable()
export class MetaGraphService {
  private get graphVersion() {
    return process.env.META_GRAPH_API_VERSION ?? 'v24.0';
  }

  private get appId() {
    return process.env.META_APP_ID;
  }

  private get appSecret() {
    return process.env.META_APP_SECRET;
  }

  private get instagramAppId() {
    return process.env.META_INSTAGRAM_APP_ID?.trim() || this.appId?.trim();
  }

  private get instagramAppSecret() {
    return (
      process.env.META_INSTAGRAM_APP_SECRET?.trim() || this.appSecret?.trim()
    );
  }

  getInstagramLoginAppId() {
    if (!this.instagramAppId) {
      throw new BadRequestException(
        'Instagram Login app ID is not configured.',
      );
    }

    return this.instagramAppId;
  }

  getInstagramLoginConfig() {
    const appId = this.getInstagramLoginAppId();
    this.requireInstagramAppSecret();
    return { appId };
  }

  async exchangeInstagramCode(input: { code: string; redirectUri: string }) {
    const appId = this.getInstagramLoginAppId();
    const appSecret = this.requireInstagramAppSecret();
    const body = new FormData();
    body.set('client_id', appId);
    body.set('client_secret', appSecret);
    body.set('grant_type', 'authorization_code');
    body.set('redirect_uri', input.redirectUri);
    body.set('code', input.code);

    const response = await this.fetchInstagram(
      'https://api.instagram.com/oauth/access_token',
      {
        method: 'POST',
        body,
      },
    );
    const data = (await this.readJson(
      response,
    )) as InstagramShortLivedTokenResponse;
    const token = data.data?.[0] ?? data;

    if (!response.ok || data.error || !token.access_token) {
      throw new BadRequestException('Instagram token exchange failed.');
    }

    return {
      accessToken: token.access_token,
      userId:
        token.user_id === undefined || token.user_id === null
          ? null
          : String(token.user_id),
      permissions: this.normalizePermissions(token.permissions),
    };
  }

  async exchangeInstagramLongLivedToken(shortLivedAccessToken: string) {
    const appSecret = this.requireInstagramAppSecret();
    const url = new URL('https://graph.instagram.com/access_token');
    url.searchParams.set('grant_type', 'ig_exchange_token');
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('access_token', shortLivedAccessToken);

    const response = await this.fetchInstagram(url, { method: 'GET' });
    const data = (await this.readJson(
      response,
    )) as InstagramLongLivedTokenResponse;

    if (!response.ok || data.error || !data.access_token) {
      throw new BadRequestException(
        'Instagram long-lived token exchange failed.',
      );
    }

    return {
      accessToken: data.access_token,
      tokenType: data.token_type ?? null,
      expiresIn: data.expires_in ?? null,
    };
  }

  async getInstagramAuthorizedAccount(accessToken: string) {
    const url = new URL(`https://graph.instagram.com/${this.graphVersion}/me`);
    url.searchParams.set('fields', 'id,user_id,username');
    url.searchParams.set('access_token', accessToken);

    const response = await this.fetchInstagram(url, { method: 'GET' });
    const data = (await this.readJson(response)) as InstagramIdentityResponse;
    const identity = data.data?.[0] ?? data;

    if (
      !response.ok ||
      data.error ||
      ((identity.id === undefined || identity.id === null) &&
        (identity.user_id === undefined || identity.user_id === null))
    ) {
      throw new BadRequestException('Instagram identity lookup failed.');
    }

    return {
      accountId: String(identity.user_id ?? identity.id),
      scopedId:
        identity.id === undefined || identity.id === null
          ? null
          : String(identity.id),
      username: identity.username?.trim() || null,
    };
  }

  async getInstagramUserProfile(input: {
    scopedUserId: string;
    accessToken: string;
  }) {
    const url = new URL(
      `https://graph.instagram.com/${this.graphVersion}/${input.scopedUserId}`,
    );
    url.searchParams.set('fields', 'id,name,username,profile_pic');

    const response = await this.fetchInstagram(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });
    const data = (await this.readJson(
      response,
    )) as InstagramUserProfileResponse;

    if (!response.ok || data.error) {
      throw new BadRequestException('Instagram user profile lookup failed.');
    }

    return {
      id: data.id == null ? input.scopedUserId : String(data.id),
      name: data.name?.trim() || null,
      username: data.username?.trim() || null,
      profilePictureUrl: data.profile_pic?.trim() || null,
    };
  }

  async subscribeInstagramAccountToWebhooks(input: {
    igUserId: string;
    accessToken: string;
    subscribedFields: readonly InstagramMessagingWebhookField[];
  }) {
    const url = new URL(
      `https://graph.instagram.com/${this.graphVersion}/${input.igUserId}/subscribed_apps`,
    );
    url.searchParams.set('subscribed_fields', input.subscribedFields.join(','));

    const response = await this.fetchInstagram(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
    });
    const data = (await this.readJson(
      response,
    )) as InstagramWebhookSubscriptionResponse;

    if (!response.ok || data.error || data.success !== true) {
      throw new BadRequestException('Instagram webhook subscription failed.');
    }

    return { success: true as const };
  }

  async getInstagramAccountWebhookSubscriptions(input: {
    igUserId: string;
    accessToken: string;
  }) {
    const url = new URL(
      `https://graph.instagram.com/${this.graphVersion}/${input.igUserId}/subscribed_apps`,
    );
    const response = await this.fetchInstagram(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
    });
    const data = (await this.readJson(
      response,
    )) as InstagramWebhookSubscriptionsResponse;

    if (!response.ok || data.error || !Array.isArray(data.data)) {
      throw new BadRequestException(
        'Instagram webhook subscriptions lookup failed.',
      );
    }

    const subscribedFields = [
      ...new Set(
        data.data.flatMap((subscription) =>
          Array.isArray(subscription.subscribed_fields)
            ? subscription.subscribed_fields.filter(
                (field): field is string => typeof field === 'string',
              )
            : [],
        ),
      ),
    ];

    return {
      appSubscribed: data.data.length > 0,
      subscribedFields,
    };
  }

  async exchangeCodeForBusinessToken(code: string) {
    if (!this.appId || !this.appSecret) {
      throw new BadRequestException(
        'META_APP_ID and META_APP_SECRET are required.',
      );
    }

    const url = new URL(
      `https://graph.facebook.com/${this.graphVersion}/oauth/access_token`,
    );

    url.searchParams.set('client_id', this.appId);
    url.searchParams.set('client_secret', this.appSecret);
    url.searchParams.set('code', code);

    const response = await fetch(url.toString(), {
      method: 'GET',
    });

    const data = (await response.json()) as ExchangeCodeResponse;

    if (!response.ok || data.error || !data.access_token) {
      throw new BadRequestException({
        message: 'Failed to exchange Embedded Signup code for business token.',
        status: response.status,
        error: data.error ?? data,
      });
    }

    return {
      accessToken: data.access_token,
      tokenType: data.token_type ?? null,
      expiresIn: data.expires_in ?? null,
      raw: data,
    };
  }

  async subscribeAppToWaba(input: { wabaId: string; accessToken: string }) {
    const url = `https://graph.facebook.com/${this.graphVersion}/${input.wabaId}/subscribed_apps`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
    });

    const data = (await response.json()) as SubscribeWabaResponse;

    if (!response.ok || data.error) {
      throw new BadRequestException({
        message: 'Failed to subscribe app to customer WABA webhooks.',
        status: response.status,
        error: data.error ?? data,
      });
    }

    return data;
  }

  async registerPhoneNumber(input: {
    phoneNumberId: string;
    accessToken: string;
    pin?: string;
  }) {
    const url = `https://graph.facebook.com/${this.graphVersion}/${input.phoneNumberId}/register`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        ...(input.pin ? { pin: input.pin } : {}),
      }),
    });

    const data = (await response.json()) as RegisterPhoneNumberResponse;

    if (!response.ok || data.error) {
      throw new BadRequestException({
        message: 'Failed to register WhatsApp phone number.',
        status: response.status,
        error: data.error ?? data,
      });
    }

    return data;
  }

  async getWhatsAppPhoneNumber(input: {
    phoneNumberId: string;
    accessToken: string;
  }) {
    const fields = [
      'id',
      'display_phone_number',
      'verified_name',
      'quality_rating',
      'messaging_limit_tier',
      'platform_type',
      'code_verification_status',
    ].join(',');

    const url = `https://graph.facebook.com/${this.graphVersion}/${input.phoneNumberId}?fields=${fields}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
    });

    const data = (await response.json()) as WhatsAppPhoneNumberResponse;

    if (!response.ok || data.error) {
      throw new BadRequestException({
        message: 'Failed to fetch WhatsApp phone number health.',
        status: response.status,
        error: data.error ?? data,
      });
    }

    return data;
  }

  private requireInstagramAppSecret() {
    if (!this.instagramAppSecret) {
      throw new BadRequestException(
        'Instagram Login app secret is not configured.',
      );
    }

    return this.instagramAppSecret;
  }

  private normalizePermissions(value: string | string[] | undefined) {
    if (Array.isArray(value)) {
      return value.map((permission) => permission.trim()).filter(Boolean);
    }

    return (value ?? '')
      .split(',')
      .map((permission) => permission.trim())
      .filter(Boolean);
  }

  private async fetchInstagram(url: string | URL, init: RequestInit) {
    try {
      return await fetch(url, init);
    } catch {
      throw new BadRequestException('Instagram API request failed.');
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }
}
