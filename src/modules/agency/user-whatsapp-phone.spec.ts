import { resolveUserWhatsAppPhone } from './user-whatsapp-phone';

describe('resolveUserWhatsAppPhone', () => {
  it('uses the phone when the user says it is also their WhatsApp', () => {
    expect(
      resolveUserWhatsAppPhone({
        phone: '+5511900000000',
        whatsappPhone: null,
        whatsappSameAsPhone: true,
      }),
    ).toBe('+5511900000000');
  });

  it('uses the dedicated number when the phone is not the WhatsApp', () => {
    expect(
      resolveUserWhatsAppPhone({
        phone: '+551133334444',
        whatsappPhone: '+5511911112222',
        whatsappSameAsPhone: false,
      }),
    ).toBe('+5511911112222');
  });

  // Sem isto, alguém que desmarcou justamente para dizer "meu fixo não é
  // WhatsApp" receberia a mensagem no fixo.
  it('returns nothing when the phone is not the WhatsApp and no number was given', () => {
    expect(
      resolveUserWhatsAppPhone({
        phone: '+551133334444',
        whatsappPhone: '   ',
        whatsappSameAsPhone: false,
      }),
    ).toBeNull();
  });

  it('keeps the historical behaviour for profiles saved before the field existed', () => {
    expect(resolveUserWhatsAppPhone({ phone: '+5511900000000' })).toBe(
      '+5511900000000',
    );
  });

  it('has nothing to resolve without a profile', () => {
    expect(resolveUserWhatsAppPhone(null)).toBeNull();
    expect(resolveUserWhatsAppPhone({ phone: null })).toBeNull();
  });
});
