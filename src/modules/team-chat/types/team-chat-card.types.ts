/**
 * Structured content a module can publish into a Team Chat channel.
 *
 * The chat renders message bodies as text — deliberately, since escaping every
 * message is what keeps a chat safe. So a rich post is not HTML in `body`: it is
 * data in `metadata.card`, which the client renders with a component it owns.
 * The plain `body` stays alongside it and is what the sidebar preview, the
 * search index and any notification read, so a viewer that does not know this
 * contract still sees the summary instead of nothing.
 */
export type TeamChatCardTone = 'neutral' | 'positive' | 'negative' | 'warning';

export interface TeamChatCardMetric {
  label: string;
  value: string;
  tone?: TeamChatCardTone;
}

export interface TeamChatCardRow {
  label: string;
  value: string;
}

export interface TeamChatCardGroup {
  title: string;
  rows: TeamChatCardRow[];
  /** Shown when the group was truncated, e.g. "mais 3 responsáveis". */
  moreLabel?: string;
}

export interface TeamChatMessageCard {
  kind: 'metrics_digest';
  title: string;
  subtitle?: string;
  metrics: TeamChatCardMetric[];
  groups?: TeamChatCardGroup[];
  cta?: { label: string; href: string };
}

/** Who the message appears to come from when no human wrote it. */
export interface TeamChatCardSender {
  displayName: string;
  agentId?: string | null;
  agentType?: string | null;
}

export interface TeamChatCardPostInput {
  tenantId: string;
  workspaceId: string;
  channelId: string;
  /** Makes a retried publication land once. */
  dedupeKey: string;
  sender: TeamChatCardSender;
  body: string;
  card: TeamChatMessageCard;
  source?: { module: string; resourceId?: string | null };
}

export type TeamChatCardPostResult =
  | { status: 'posted'; messageId: string }
  | { status: 'duplicate'; messageId: string }
  | { status: 'channel_unavailable' };
