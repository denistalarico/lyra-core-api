import { renderTransactionalEmail } from '../../email/templates/transactional-email.template';

/**
 * Why Lyra (and not Autentique) delivers a signing link:
 * - `author`: Autentique never e-mails the document author (the account that
 *   owns the API token), even when the author is a signer;
 * - `failed`: Autentique reported the e-mail to this signer as refused;
 * - `manual`: a user asked to (re)send it from the contract.
 */
export type SigningLinkEmailReason = 'author' | 'failed' | 'manual';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only an https link (as Autentique returns) ever goes into the e-mail. */
export function isHttpsUrl(url: string) {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function renderContractSigningEmail(input: {
  signerName: string;
  contractTitle: string;
  agencyName: string | null;
  url: string;
}) {
  const sender = input.agencyName?.trim() || 'A agência';
  const title = input.contractTitle.trim() || 'Contrato';
  const intro = `Olá, ${escapeHtml(input.signerName.trim() || 'tudo bem')}! ${escapeHtml(sender)} enviou o contrato <strong>${escapeHtml(title)}</strong> para a sua assinatura digital pelo Autentique.`;

  const { html } = renderTransactionalEmail({
    title: 'Contrato para assinar',
    intro,
    buttonLabel: 'Assinar contrato',
    buttonUrl: escapeHtml(input.url),
    secondaryText:
      'O link é pessoal: quem o abrir assina como você. Não encaminhe este e-mail.',
    footerText:
      'E-mail enviado pela Lyra em nome da agência. A assinatura é feita no Autentique.',
  });

  const text = [
    'Contrato para assinar',
    '',
    `${sender} enviou o contrato "${title}" para a sua assinatura digital pelo Autentique.`,
    '',
    `Assinar: ${input.url}`,
    '',
    'O link é pessoal: quem o abrir assina como você. Não encaminhe este e-mail.',
  ].join('\n');

  return { subject: `Contrato para assinar: ${title}`, html, text };
}
