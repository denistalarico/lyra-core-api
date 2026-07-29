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

function normalizeOptOutText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[.!?,;:]+$/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}
