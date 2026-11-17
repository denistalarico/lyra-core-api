import {
  buildPlusAddress,
  detectForwardingConfirmation,
  extractEmailLead,
  extractPairs,
  htmlToText,
  isSenderAllowed,
  needsAiExtraction,
  slugForForm,
} from './form-email.extractor';
import { parseRecipientHeaders } from './services/form-email-imap.gateway';

const base = {
  messageId: '<m1@site>',
  subject: 'Novo contato pelo site',
  from: 'WordPress <wordpress@site.com.br>',
  replyTo: null,
  date: null,
  html: null,
};
const OWN = ['leads@agencia.com.br', 'leads+site-ab12@agencia.com.br'];

describe('addresses', () => {
  it('plus address keeps the box domain and drops an existing +tag', () => {
    expect(buildPlusAddress('Leads+x@Agencia.com.br', 'lp-1a2b')).toBe(
      'leads+lp-1a2b@agencia.com.br',
    );
    expect(slugForForm('Orçamento — Página Principal')).toMatch(
      /^orcamento-pagina-princip-[0-9a-f]{4}$/,
    );
  });

  it('allowed senders: exact or @domain', () => {
    expect(isSenderAllowed('Site <no-reply@site.com.br>', [])).toBe(true);
    expect(
      isSenderAllowed('Site <no-reply@site.com.br>', ['@site.com.br']),
    ).toBe(true);
    expect(isSenderAllowed('x@evil.com', ['@site.com.br', 'a@b.co'])).toBe(
      false,
    );
  });

  it('recipient headers: unfolds, ignores the Message-ID address', () => {
    const parsed = parseRecipientHeaders(
      'To: Leads <leads+site-ab12@agencia.com.br>,\r\n  outro@x.com\r\nMessage-ID: <abc@agencia.com.br>\r\nDelivered-To: leads@agencia.com.br\r\n',
    );
    expect(parsed.messageId).toBe('<abc@agencia.com.br>');
    expect(parsed.recipients).toContain('leads+site-ab12@agencia.com.br');
    expect(parsed.recipients).toContain('outro@x.com');
    expect(parsed.recipients).not.toContain('abc@');
  });
});

describe('extractEmailLead', () => {
  it('reads "Campo: valor" lines and never uses From as the lead', () => {
    const { normalized, fields } = extractEmailLead(
      {
        ...base,
        text: 'Nome: Ana Souza\nE-mail: ANA@cliente.com\nTelefone: (11) 98888-7777\nMensagem: Quero um orçamento\nhttps://site.com.br/contato',
      },
      { ownAddresses: OWN },
    );
    expect(fields.map((f) => f.key)).toEqual([
      'Nome',
      'E-mail',
      'Telefone',
      'Mensagem',
    ]);
    expect(normalized.lead).toMatchObject({
      name: 'Ana Souza',
      email: 'ana@cliente.com',
      phone: '+5511988887777',
    });
    expect(normalized.opportunity.notes).toBe('Quero um orçamento');
    expect(normalized.summaryLines[0]).toBe(
      'Assunto do e-mail: Novo contato pelo site',
    );
    expect(normalized.extractedBy).toBe('rules');
  });

  it('reads 2-column HTML tables', () => {
    const html =
      '<table><tr><th>Nome:</th><td><b>Bruno</b></td></tr><tr><td>Whatsapp</td><td>11 3333-4444</td></tr></table>';
    const { normalized } = extractEmailLead(
      { ...base, html, text: htmlToText(html) },
      { ownAddresses: OWN },
    );
    expect(normalized.lead.name).toBe('Bruno');
    expect(normalized.lead.phone).toBe('+551133334444');
  });

  it('falls back to an address in the body, then Reply-To, skipping the agency box and technical senders', () => {
    const body = extractEmailLead(
      {
        ...base,
        text: 'Responder para leads@agencia.com.br. Cliente: noreply@x.com joao@gmail.com',
      },
      { ownAddresses: OWN },
    );
    expect(body.normalized.lead.email).toBe('joao@gmail.com');

    const replyTo = extractEmailLead(
      {
        ...base,
        replyTo: 'Maria <maria@empresa.com>',
        text: 'Olá, quero falar com vocês.',
      },
      { ownAddresses: OWN },
    );
    expect(replyTo.normalized.lead.email).toBe('maria@empresa.com');
    // No pairs: the body becomes the opportunity notes.
    expect(replyTo.normalized.opportunity.notes).toBe(
      'Olá, quero falar com vocês.',
    );

    const fromOnly = extractEmailLead(
      { ...base, from: 'Pedro <pedro@gmail.com>', text: 'Sem dados.' },
      { ownAddresses: OWN },
    );
    expect(fromOnly.normalized.lead.email).toBeNull();
    expect(needsAiExtraction(fromOnly.normalized)).toBe(true);
  });

  it('respects the saved field mapping', () => {
    const fields = extractPairs('Campo 3: Carla\nCampo 4: carla@x.com', null);
    const { normalized } = extractEmailLead(
      { ...base, text: '' },
      { ownAddresses: OWN, fields, fieldMap: { 'Campo 3': 'contact.name' } },
    );
    expect(normalized.lead.name).toBe('Carla');
    expect(normalized.lead.email).toBe('carla@x.com');
  });
});

describe('detectForwardingConfirmation', () => {
  it('catches Gmail confirmation with its link; normal mail is not one', () => {
    expect(
      detectForwardingConfirmation({
        from: 'Equipe do Gmail <forwarding-noreply@google.com>',
        subject: '(#123) Confirmação de encaminhamento do Gmail',
        text: 'Clique: https://mail-settings.google.com/mail/vf-abc123 para confirmar.',
      }),
    ).toMatchObject({ url: 'https://mail-settings.google.com/mail/vf-abc123' });
    expect(
      detectForwardingConfirmation({
        from: 'a@b.co',
        subject: 'Contato',
        text: 'oi',
      }),
    ).toBeNull();
  });
});
