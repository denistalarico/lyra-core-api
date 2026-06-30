type InvoiceEmailCompany = {
  name: string;
  legalName?: string | null;
  taxId?: string | null;
  taxIdType?: string | null;
  logoUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  addressLine?: string | null;
};

type InvoiceEmailOptions = {
  company: InvoiceEmailCompany;
  customerName: string;
  invoiceNumber: string;
  totalLabel: string;
  dueDateLabel: string;
  publicUrl?: string | null;
};

function escapeHtml(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderInvoiceEmail(options: InvoiceEmailOptions) {
  const companyName = options.company.name || options.company.legalName || 'Sua empresa';
  const logo = options.company.logoUrl
    ? `<img src="${escapeHtml(options.company.logoUrl)}" alt="${escapeHtml(companyName)}" width="132" style="display:block;max-width:132px;max-height:58px;width:auto;height:auto;border:0;" />`
    : `<strong style="font-size:18px;color:#0f172a;">${escapeHtml(companyName)}</strong>`;
  const companyDetails = [
    options.company.legalName && options.company.legalName !== companyName
      ? options.company.legalName
      : null,
    options.company.taxId ? `${options.company.taxIdType || 'Documento'} ${options.company.taxId}` : null,
    options.company.addressLine,
    options.company.email,
    options.company.phone,
    options.company.website,
  ].filter(Boolean);
  const publicButton = options.publicUrl
    ? `
      <tr>
        <td align="center" style="padding:20px 32px 6px;">
          <a href="${escapeHtml(options.publicUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 18px;border-radius:8px;">
            Ver fatura online
          </a>
        </td>
      </tr>
    `
    : '';

  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f8fafc;font-family:Inter,Arial,sans-serif;color:#0f172a;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f8fafc;padding:32px 16px;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 18px;border-bottom:1px solid #e2e8f0;">
                ${logo}
                <div style="margin-top:12px;color:#64748b;font-size:12px;line-height:1.6;">
                  ${companyDetails.map((item) => `<div>${escapeHtml(String(item))}</div>`).join('')}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 8px;">
                <h1 style="margin:0 0 10px;font-size:22px;line-height:1.25;color:#0f172a;">Fatura ${escapeHtml(options.invoiceNumber)}</h1>
                <p style="margin:0;color:#334155;font-size:15px;line-height:1.7;">
                  Olá ${escapeHtml(options.customerName)}, segue em anexo a fatura referente aos serviços prestados.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 32px;">
                <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
                  <tr>
                    <td style="padding:14px 16px;color:#64748b;font-size:12px;border-bottom:1px solid #e2e8f0;">Valor</td>
                    <td align="right" style="padding:14px 16px;font-size:14px;font-weight:700;border-bottom:1px solid #e2e8f0;">${escapeHtml(options.totalLabel)}</td>
                  </tr>
                  <tr>
                    <td style="padding:14px 16px;color:#64748b;font-size:12px;">Vencimento</td>
                    <td align="right" style="padding:14px 16px;font-size:14px;font-weight:700;">${escapeHtml(options.dueDateLabel)}</td>
                  </tr>
                </table>
              </td>
            </tr>
            ${publicButton}
            <tr>
              <td style="padding:24px 32px 30px;color:#64748b;font-size:13px;line-height:1.6;">
                Caso já tenha realizado o pagamento, desconsidere este aviso. Se precisar de qualquer ajuste, responda este e-mail.
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;background:#f8fafc;color:#94a3b8;font-size:12px;text-align:center;border-top:1px solid #e2e8f0;">
                Enviado com Lyra Suite
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `Fatura ${options.invoiceNumber}`,
    '',
    `Olá ${options.customerName}, segue em anexo a fatura referente aos serviços prestados.`,
    `Valor: ${options.totalLabel}`,
    `Vencimento: ${options.dueDateLabel}`,
    options.publicUrl ? `Ver fatura online: ${options.publicUrl}` : '',
    '',
    companyName,
    ...companyDetails.map(String),
    '',
    'Enviado com Lyra Suite',
  ].filter(Boolean).join('\n');

  return { html, text };
}
