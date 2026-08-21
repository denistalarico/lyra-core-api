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

  // Echoes are the business's own outbound activity captured via webhook
  // (e.g. an operator replying from Meta's native inbox). Only Messenger
  // declares this today; routes through InboundMessageIngestionService's
  // dedicated ingestEcho() path, never the inbound ingest() path.
  normalizeEchoes?(
    payload: TPayload,
  ): Promise<{ messages: NormalizedInboundMessage[] }>;
}
