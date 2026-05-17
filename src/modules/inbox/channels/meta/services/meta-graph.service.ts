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
}
