import type { NormalizedInboundMessage } from './normalized-inbound-message';
import type { NormalizedMessageReactionUpdate } from './normalized-message-reaction-update';
import type {
  NormalizedMessageStatusUpdate,
  NormalizedMessageStatusWatermarkUpdate,
} from './normalized-message-status-update';

export type ChannelAdapterResult = {
  messages: NormalizedInboundMessage[];
};

export interface ChannelAdapter<TPayload = unknown> {
  readonly provider: string;

  normalize(payload: TPayload): Promise<ChannelAdapterResult>;

  // Not every provider emits delivery/read or reaction events, so adapters
  // only declare these when the channel actually supports them.
  // statusWatermarks is for providers (Messenger) that report status by
  // thread + timestamp instead of by message id.
  normalizeStatuses?(payload: TPayload): Promise<{
    statuses: NormalizedMessageStatusUpdate[];
    statusWatermarks?: NormalizedMessageStatusWatermarkUpdate[];
  }>;
  normalizeReactions?(
    payload: TPayload,
  ): Promise<{ reactions: NormalizedMessageReactionUpdate[] }>;
}
