import { Injectable } from '@nestjs/common';
import { TelnyxSmsProvider } from './telnyx/telnyx-sms.provider';
import {
  isSmsProviderKey,
  SmsProviderError,
  type SmsProviderAdapter,
  type SmsProviderKey,
} from './sms-provider.adapter';

/** Adapter by `inbox_channels.provider`. Twilio (IX-F9) registers here. */
@Injectable()
export class SmsProviderRegistry {
  private readonly adapters: ReadonlyMap<SmsProviderKey, SmsProviderAdapter>;

  constructor(telnyx: TelnyxSmsProvider) {
    this.adapters = new Map([[telnyx.provider, telnyx]]);
  }

  get(provider: unknown): SmsProviderAdapter {
    const adapter = isSmsProviderKey(provider)
      ? this.adapters.get(provider)
      : undefined;
    if (!adapter) throw new SmsProviderError('sms_provider_unsupported');
    return adapter;
  }
}
