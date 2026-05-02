type TransactionalEmailOptions = {
  title: string;
  intro: string;
  buttonLabel?: string;
  buttonUrl?: string;
  secondaryText?: string;
  footerText?: string;
};

const defaultFrontendUrl = 'http://82.29.61.35:3001';

function getLogoUrl() {
  const frontendUrl = process.env.APP_FRONTEND_URL ?? defaultFrontendUrl;

  return `${frontendUrl.replace(/\/$/, '')}/brand/logo-full-light.svg`;
}

export function renderTransactionalEmail(options: TransactionalEmailOptions) {
  const logoUrl = getLogoUrl();
  const footer =
    options.footerText ??
    'Este é um e-mail automático de segurança da Lyra Suite. Se você não reconhece esta ação, recomendamos redefinir sua senha imediatamente.';

  const button =
    options.buttonLabel && options.buttonUrl
      ? `
        <tr>
          <td align="center" style="padding: 24px 32px;">
            <a href="${options.buttonUrl}" style="display:inline-block;background:#2563EB;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 18px;border-radius:10px;">
              ${options.buttonLabel}
            </a>
          </td>
        </tr>
      `
      : '';

  const secondary = options.secondaryText
    ? `
      <tr>
        <td style="padding:8px 32px 0;color:#64748B;font-size:14px;line-height:1.6;">
          ${options.secondaryText}
        </td>
      </tr>
    `
    : '';

  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#F8FAFC;font-family:Inter,Arial,sans-serif;color:#0F172A;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#F8FAFC;padding:32px 16px;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;background:#ffffff;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;">
            <tr>
              <td align="center" style="padding:32px 32px 20px;">
                <img src="${logoUrl}" alt="Lyra Suite" width="150" style="display:block;width:150px;max-width:150px;height:auto;border:0;outline:none;text-decoration:none;" />
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px;text-align:center;">
                <h1 style="margin:0;font-size:24px;line-height:1.25;color:#0F172A;">
                  ${options.title}
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0;color:#334155;font-size:15px;line-height:1.7;text-align:center;">
                ${options.intro}
              </td>
            </tr>
            ${button}
            ${secondary}
            <tr>
              <td style="padding:24px 32px 32px;color:#64748B;font-size:12px;line-height:1.6;text-align:center;border-top:1px solid #E2E8F0;">
                ${footer}
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;color:#94A3B8;font-size:12px;text-align:center;">
            © Lyra Suite · Talarico Labs
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    options.title,
    '',
    options.intro,
    options.buttonUrl
      ? `\n${options.buttonLabel ?? 'Abrir link'}: ${options.buttonUrl}`
      : '',
    options.secondaryText ?? '',
    '',
    footer,
    '',
    '© Lyra Suite · Talarico Labs',
  ]
    .filter(Boolean)
    .join('\n');

  return { html, text };
}
