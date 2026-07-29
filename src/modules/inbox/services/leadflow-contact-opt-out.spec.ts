import {
  hasLeadFlowOutboundOptOut,
  isExplicitLeadFlowOptOut,
} from './leadflow-contact-opt-out';

describe('LeadFlow contact opt-out', () => {
  it.each([
    'STOP',
    'parar',
    'Não quero receber mensagens',
    'remover meu número',
  ])('recognizes the explicit command %p', (value) => {
    expect(isExplicitLeadFlowOptOut(value)).toBe(true);
  });

  it.each(['quero parar amanhã', 'cancelar pedido', 'não', ''])(
    'does not infer opt-out from ambiguous text %p',
    (value) => {
      expect(isExplicitLeadFlowOptOut(value)).toBe(false);
    },
  );

  it('reads the canonical conversation metadata flag', () => {
    expect(
      hasLeadFlowOutboundOptOut({
        metadata: {
          leadflowOutboundOptOut: {
            status: 'opted_out',
            recordedAt: '2026-07-28T12:00:00.000Z',
            source: 'inbound_keyword',
            sourceMessageId: 'message-1',
          },
        },
      }),
    ).toBe(true);
  });
});
