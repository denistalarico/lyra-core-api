import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  FacebookPageGraphAsset,
  FacebookPageInstagramAccountAsset,
} from '../types/meta-assets.types';

const META_GRAPH_ORIGIN = 'https://graph.facebook.com';
const MAX_FACEBOOK_PAGE_RESULT_PAGES = 100;

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

type FacebookUserAccessTokenResponse = {
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

type FacebookPageWebhookSubscriptionResponse = {
  success?: unknown;
  error?: unknown;
  error_subcode?: unknown;
};

type FacebookPageWebhookSubscriptionsResponse = {
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
  private readonly logger = new Logger(MetaGraphService.name);

  private get graphVersion() {
    return process.env.META_GRAPH_API_VERSION ?? 'v24.0';
  }

  private get appId() {
    return process.env.META_APP_ID;
  }

  private get appSecret() {
    return process.env.META_APP_SECRET;
  }

  private get facebookLoginConfigId() {
    return process.env.META_FACEBOOK_LOGIN_CONFIG_ID?.trim();
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

  getFacebookLoginConfig() {
    const appId = this.requireMetaAppId();
    this.requireMetaAppSecret();

    if (!this.facebookLoginConfigId) {
      throw new BadRequestException(
        'Facebook Login for Business configuration ID is not configured.',
      );
    }

    return {
      appId,
      configId: this.facebookLoginConfigId,
      authorizationEndpoint: `https://www.facebook.com/${this.graphVersion}/dialog/oauth`,
    };
  }

  async exchangeFacebookOAuthCode(input: {
    code: string;
    redirectUri: string;
  }) {
    const appId = this.requireMetaAppId();
    const appSecret = this.requireMetaAppSecret();
    const url = new URL(
      `${META_GRAPH_ORIGIN}/${this.graphVersion}/oauth/access_token`,
    );
    url.searchParams.set('client_id', appId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('code', input.code);

    const response = await this.fetchMeta(url, { method: 'GET' });
    const data = (await this.readJson(
      response,
    )) as FacebookUserAccessTokenResponse;

    if (!response.ok || data.error || !data.access_token) {
      throw new BadRequestException('Facebook OAuth token exchange failed.');
    }

    return {
      accessToken: data.access_token,
      tokenType: data.token_type ?? null,
      expiresIn: data.expires_in ?? null,
    };
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

  async listFacebookPages(
    userAccessToken: string,
  ): Promise<FacebookPageGraphAsset[]> {
    const pages: FacebookPageGraphAsset[] = [];
    const seenCursors = new Set<string>();
    let nextUrl: URL | null = this.createFacebookPagesUrl();

    for (
      let pageNumber = 0;
      nextUrl && pageNumber < MAX_FACEBOOK_PAGE_RESULT_PAGES;
      pageNumber += 1
    ) {
      const response = await this.fetchMeta(nextUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${userAccessToken}` },
      });
      const data = await this.readJson(response);

      if (!response.ok || !this.isRecord(data) || data.error) {
        throw new BadRequestException('Facebook Pages lookup failed.');
      }

      if (!Array.isArray(data.data)) {
        throw new BadRequestException(
          'Facebook Pages lookup returned an invalid response.',
        );
      }

      pages.push(...data.data.map((page) => this.parseFacebookPage(page)));
      nextUrl = this.getNextFacebookPagesUrl(data.paging, seenCursors);
    }

    if (nextUrl) {
      throw new BadRequestException(
        'Facebook Pages pagination exceeded the safe limit.',
      );
    }

    return pages;
  }

  async getFacebookPageInstagramAccount(input: {
    pageId: string;
    pageAccessToken: string;
  }): Promise<FacebookPageInstagramAccountAsset | null> {
    const url = new URL(
      `${META_GRAPH_ORIGIN}/${this.graphVersion}/${encodeURIComponent(input.pageId)}`,
    );
    url.searchParams.set('fields', 'instagram_business_account{id,username}');

    const response = await this.fetchMeta(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${input.pageAccessToken}` },
    });
    const data = await this.readJson(response);

    if (!response.ok || !this.isRecord(data) || data.error) {
      throw new BadRequestException(
        'Facebook Page Instagram account lookup failed.',
      );
    }

    const account = data.instagram_business_account;
    if (account === undefined || account === null) {
      return null;
    }

    if (!this.isRecord(account) || !this.isNonEmptyString(account.id)) {
      throw new BadRequestException(
        'Facebook Page Instagram account lookup returned an invalid response.',
      );
    }

    if (
      account.username !== undefined &&
      account.username !== null &&
      typeof account.username !== 'string'
    ) {
      throw new BadRequestException(
        'Facebook Page Instagram account lookup returned an invalid response.',
      );
    }

    return {
      accountId: account.id.trim(),
      username:
        typeof account.username === 'string'
          ? account.username.trim() || null
          : null,
    };
  }

  async subscribeFacebookPageToInstagramWebhooks(input: {
    pageId: string;
    pageAccessToken: string;
    subscribedFields: readonly InstagramMessagingWebhookField[];
  }) {
    const url = new URL(
      `${META_GRAPH_ORIGIN}/${this.graphVersion}/${encodeURIComponent(input.pageId)}/subscribed_apps`,
    );
    url.searchParams.set('subscribed_fields', input.subscribedFields.join(','));

    const response = await this.fetchMeta(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.pageAccessToken}` },
    });
    const responsePayload = await this.readJson(response);
    const data: FacebookPageWebhookSubscriptionResponse = this.isRecord(
      responsePayload,
    )
      ? responsePayload
      : {};

    if (!response.ok || data.error || data.success !== true) {
      const graphError = this.isRecord(data.error) ? data.error : null;
      const nestedSubcode = graphError?.error_subcode;
      const topLevelSubcode = data.error_subcode;

      this.logger.error('Meta webhook subscription failed', {
        operation: 'subscribeFacebookPageToInstagramWebhooks',
        status: response.status,
        type: typeof graphError?.type === 'string' ? graphError.type : null,
        code: typeof graphError?.code === 'number' ? graphError.code : null,
        subcode:
          typeof nestedSubcode === 'number'
            ? nestedSubcode
            : typeof topLevelSubcode === 'number'
              ? topLevelSubcode
              : null,
        message: this.sanitizeMetaErrorMessage(graphError?.message, [
          input.pageAccessToken,
          this.appSecret,
          this.instagramAppSecret,
        ]),
      });

      throw new BadRequestException(
        'Facebook Page webhook subscription failed.',
      );
    }

    return { success: true as const };
  }

  async getFacebookPageWebhookSubscriptions(input: {
    pageId: string;
    pageAccessToken: string;
  }) {
    const url = new URL(
      `${META_GRAPH_ORIGIN}/${this.graphVersion}/${encodeURIComponent(input.pageId)}/subscribed_apps`,
    );
    const response = await this.fetchMeta(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${input.pageAccessToken}` },
    });
    const data = (await this.readJson(
      response,
    )) as FacebookPageWebhookSubscriptionsResponse;

    if (!response.ok || data.error || !Array.isArray(data.data)) {
      throw new BadRequestException(
        'Facebook Page webhook subscriptions lookup failed.',
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

  async getFacebookInstagramUserProfile(input: {
    scopedUserId: string;
    pageAccessToken: string;
  }) {
    const url = new URL(
      `${META_GRAPH_ORIGIN}/${this.graphVersion}/${encodeURIComponent(input.scopedUserId)}`,
    );
    url.searchParams.set('fields', 'id,name,username,profile_pic');

    const response = await this.fetchMeta(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${input.pageAccessToken}` },
    });
    const data = (await this.readJson(
      response,
    )) as InstagramUserProfileResponse;

    if (!response.ok || data.error) {
      throw new BadRequestException(
        'Facebook Instagram user profile lookup failed.',
      );
    }

    return {
      id: data.id == null ? input.scopedUserId : String(data.id),
      name: data.name?.trim() || null,
      username: data.username?.trim() || null,
      profilePictureUrl: data.profile_pic?.trim() || null,
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

  private requireMetaAppId() {
    const appId = this.appId?.trim();
    if (!appId) {
      throw new BadRequestException('META_APP_ID is required.');
    }

    return appId;
  }

  private requireMetaAppSecret() {
    const appSecret = this.appSecret?.trim();
    if (!appSecret) {
      throw new BadRequestException('META_APP_SECRET is required.');
    }

    return appSecret;
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

  private createFacebookPagesUrl(after?: string) {
    const url = new URL(
      `${META_GRAPH_ORIGIN}/${this.graphVersion}/me/accounts`,
    );
    url.searchParams.set('fields', 'id,name,access_token');
    if (after) {
      url.searchParams.set('after', after);
    }
    return url;
  }

  private getNextFacebookPagesUrl(
    paging: unknown,
    seenCursors: Set<string>,
  ): URL | null {
    if (paging === undefined) {
      return null;
    }

    if (!this.isRecord(paging)) {
      throw new BadRequestException(
        'Facebook Pages pagination returned an invalid response.',
      );
    }

    const next = paging.next;
    if (next === undefined) {
      return null;
    }

    if (typeof next !== 'string') {
      throw new BadRequestException(
        'Facebook Pages pagination returned an invalid response.',
      );
    }

    let parsedNext: URL;
    try {
      parsedNext = new URL(next);
    } catch {
      throw new BadRequestException(
        'Facebook Pages pagination returned an invalid response.',
      );
    }

    const expectedPathPrefix = `/${this.graphVersion}/`;
    if (
      parsedNext.origin !== META_GRAPH_ORIGIN ||
      !parsedNext.pathname.startsWith(expectedPathPrefix) ||
      parsedNext.username ||
      parsedNext.password ||
      parsedNext.hash
    ) {
      throw new BadRequestException(
        'Facebook Pages pagination returned an invalid response.',
      );
    }

    const after = parsedNext.searchParams.get('after')?.trim();
    if (!after || seenCursors.has(after)) {
      throw new BadRequestException(
        'Facebook Pages pagination returned an invalid response.',
      );
    }

    seenCursors.add(after);
    return this.createFacebookPagesUrl(after);
  }

  private parseFacebookPage(value: unknown): FacebookPageGraphAsset {
    if (
      !this.isRecord(value) ||
      !this.isNonEmptyString(value.id) ||
      !this.isNonEmptyString(value.name) ||
      !this.isNonEmptyString(value.access_token)
    ) {
      throw new BadRequestException(
        'Facebook Pages lookup returned an invalid response.',
      );
    }

    return {
      pageId: value.id.trim(),
      pageName: value.name.trim(),
      pageAccessToken: value.access_token.trim(),
    };
  }

  private async fetchMeta(url: URL, init: RequestInit) {
    try {
      return await fetch(url, init);
    } catch {
      throw new BadRequestException('Meta Graph API request failed.');
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private sanitizeMetaErrorMessage(
    value: unknown,
    knownSecrets: ReadonlyArray<string | undefined>,
  ): string | null {
    if (typeof value !== 'string') return null;

    let sanitized = value.replace(/https?:\/\/\S+/gi, '[REDACTED_URL]');
    sanitized = sanitized.replace(
      /\b(?:authorization|(?:page[\s_-]*|user[\s_-]*)?access[\s_-]*token|app[\s_-]*secret|client[\s_-]*secret|oauth[\s_-]*code|authorization[\s_-]*code|credentialsEncrypted)\s*(?::|=|\s)\s*(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)[,;]?/gi,
      '[REDACTED]',
    );
    sanitized = sanitized.replace(
      /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
      '[REDACTED]',
    );

    for (const secret of knownSecrets) {
      const normalizedSecret = secret?.trim();
      if (normalizedSecret) {
        sanitized = sanitized.split(normalizedSecret).join('[REDACTED]');
      }
    }

    return sanitized.replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }
}
