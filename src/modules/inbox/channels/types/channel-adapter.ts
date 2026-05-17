import type { NormalizedInboundMessage } from './normalized-inbound-message';

export type ChannelAdapterResult = {
  messages: NormalizedInboundMessage[];
};

export interface ChannelAdapter<TPayload = unknown> {
  readonly provider: string;

  normalize(payload: TPayload): Promise<ChannelAdapterResult>;
}
