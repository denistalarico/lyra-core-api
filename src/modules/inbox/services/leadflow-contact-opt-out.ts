import type { InboxConversationEntity } from '../entities/inbox-conversation.entity';

export const LEADFLOW_OUTBOUND_OPT_OUT_METADATA_KEY =
  'leadflowOutboundOptOut' as const;

export interface LeadFlowOutboundOptOutState {
  status: 'opted_out';
  recordedAt: string;
  source: 'inbound_keyword';
  sourceMessageId: string;
}

const OPT_OUT_PHRASES = new Set([
  'stop',
  'parar',
  'sair',
  'cancelar inscricao',
  'nao quero receber',
  'nao quero mais receber',
  'nao quero receber mensagens',
  'nao quero mais receber mensagens',
  'remova meu numero',
  'remover meu numero',
]);

/**
 * Exact, conservative recognition for an explicit request to stop automated
 * outbound. It intentionally does not match a phrase contained in a larger
 * sentence (for example "quero cancelar a consulta"), which would confuse a
 * business intent with communication consent.
 */
export function isExplicitLeadFlowOptOut(value: string): boolean {
  return OPT_OUT_PHRASES.has(normalizeOptOutText(value));
}

export function hasLeadFlowOutboundOptOut(
  conversation:
    | Pick<InboxConversationEntity, 'metadata'>
    | Record<string, unknown>
    | null
    | undefined,
): boolean {
  const metadata =
    conversation && 'metadata' in conversation
      ? conversation.metadata
      : conversation;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  const value: unknown = (metadata as Record<string, unknown>)[
    LEADFLOW_OUTBOUND_OPT_OUT_METADATA_KEY
  ];
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).status === 'opted_out'
  );
}

export function recordLeadFlowOutboundOptOut(
  metadata: Record<string, unknown> | null | undefined,
  input: { recordedAt: Date; sourceMessageId: string },
): Record<string, unknown> {
  const state: LeadFlowOutboundOptOutState = {
    status: 'opted_out',
    recordedAt: input.recordedAt.toISOString(),
    source: 'inbound_keyword',
    sourceMessageId: input.sourceMessageId,
  };
  return {
    ...(metadata ?? {}),
    [LEADFLOW_OUTBOUND_OPT_OUT_METADATA_KEY]: state,
  };
}

/**
 * SMS carrier keywords (D-IX-8). Carriers and the CTIA expect these exact,
 * single-word commands on a US long code or toll-free number; they are
 * matched only on SMS, where "end" or "cancel" alone is a command and not a
 * business intent.
 */
const SMS_OPT_OUT_KEYWORDS = new Set([
  'stop',
  'stopall',
  'unsubscribe',
  'cancel',
  'end',
  'quit',
  'parar',
]);
const SMS_OPT_IN_KEYWORDS = new Set(['start', 'unstop']);
const SMS_HELP_KEYWORDS = new Set(['help', 'info', 'ajuda']);

export type SmsKeyword = 'opt_out' | 'opt_in' | 'help';

export function classifySmsKeyword(value: string): SmsKeyword | null {
  const normalized = normalizeOptOutText(value);
  if (SMS_OPT_OUT_KEYWORDS.has(normalized)) return 'opt_out';
  if (SMS_OPT_IN_KEYWORDS.has(normalized)) return 'opt_in';
  if (SMS_HELP_KEYWORDS.has(normalized)) return 'help';
  return null;
}

/** START/UNSTOP: the contact consents again, so the refusal is lifted. */
export function clearLeadFlowOutboundOptOut(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const next = { ...(metadata ?? {}) };
  delete next[LEADFLOW_OUTBOUND_OPT_OUT_METADATA_KEY];
  return next;
}

function normalizeOptOutText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[.!?,;:]+$/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}
