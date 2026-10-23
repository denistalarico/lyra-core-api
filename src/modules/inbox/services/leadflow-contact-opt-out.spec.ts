import {
  classifySmsKeyword,
  clearLeadFlowOutboundOptOut,
  hasLeadFlowOutboundOptOut,
  isExplicitLeadFlowOptOut,
  recordLeadFlowOutboundOptOut,
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

describe('SMS carrier keywords (D-IX-8)', () => {
  it.each([
    'STOP',
    'stopall',
    'Unsubscribe',
    'CANCEL',
    'end',
    'QUIT',
    'parar',
    'Stop.',
  ])('%s is an opt-out', (text) =>
    expect(classifySmsKeyword(text)).toBe('opt_out'),
  );

  it.each(['START', 'unstop'])('%s lifts the opt-out', (text) =>
    expect(classifySmsKeyword(text)).toBe('opt_in'),
  );

  it.each(['HELP', 'info', 'ajuda'])('%s asks for help', (text) =>
    expect(classifySmsKeyword(text)).toBe('help'),
  );

  it('ignores the words inside a sentence', () => {
    expect(classifySmsKeyword('please stop calling me at night')).toBeNull();
    expect(classifySmsKeyword('quero cancelar a consulta')).toBeNull();
  });

  it('START removes the recorded opt-out and keeps the rest', () => {
    const optedOut = recordLeadFlowOutboundOptOut(
      { contactName: 'Ana' },
      { recordedAt: new Date('2026-10-23T00:00:00Z'), sourceMessageId: 'm1' },
    );
    expect(hasLeadFlowOutboundOptOut({ metadata: optedOut })).toBe(true);
    const cleared = clearLeadFlowOutboundOptOut(optedOut);
    expect(hasLeadFlowOutboundOptOut({ metadata: cleared })).toBe(false);
    expect(cleared).toEqual({ contactName: 'Ana' });
  });
});
