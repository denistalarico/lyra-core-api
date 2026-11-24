import sanitizeHtml from 'sanitize-html';

/**
 * E-mail que a equipe da agência escreve para um lead (CRM). O corpo chega do
 * editor rico (TipTap) e passa por aqui duas vezes: `sanitizeEmailHtml` ao
 * gravar a assinatura e ao enviar, e `renderLeadEmail` para a moldura com a
 * identidade da agência.
 */

const FONT = "Inter,'Segoe UI',Helvetica,Arial,sans-serif";
const DEFAULT_ACCENT = '#2563EB';
const WHATSAPP_GREEN = '#25D366';

/** Estilos inline: muitos clientes (Outlook, Gmail app) descartam <style>. */
const INLINE_STYLES: Record<string, string> = {
  p: 'margin:0 0 12px;',
  h1: 'margin:0 0 12px;font-size:22px;line-height:1.3;color:#0F172A;',
  h2: 'margin:0 0 10px;font-size:18px;line-height:1.35;color:#0F172A;',
  h3: 'margin:0 0 8px;font-size:16px;line-height:1.4;color:#0F172A;',
  ul: 'margin:0 0 12px;padding-left:22px;',
  ol: 'margin:0 0 12px;padding-left:22px;',
  li: 'margin:0 0 4px;',
  blockquote:
    'margin:0 0 12px;padding:4px 0 4px 14px;border-left:3px solid #CBD5E1;color:#475569;',
  hr: 'border:0;border-top:1px solid #E2E8F0;margin:16px 0;',
  img: 'display:inline-block;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;',
};

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'span',
  'a',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'blockquote',
  'hr',
  'img',
];

const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i];

/**
 * Allowlist estrita: só a formatação que o editor produz. Imagens só por URL
 * http(s) — `data:` some (Gmail não exibe e incharia o e-mail). Largura e
 * altura do redimensionamento do editor viram atributos, que todo cliente
 * respeita.
 */
export function sanitizeEmailHtml(html: string | null | undefined): string {
  if (!html?.trim()) return '';

  return (
    sanitizeHtml(html, {
      allowedTags: ALLOWED_TAGS,
      allowedAttributes: {
        a: ['href', 'target', 'rel'],
        img: ['src', 'alt', 'width', 'height'],
        span: ['style'],
        p: ['style'],
        h1: ['style'],
        h2: ['style'],
        h3: ['style'],
      },
      allowedStyles: {
        '*': {
          color: COLOR,
          'text-align': [/^(left|right|center|justify)$/],
        },
      },
      allowedSchemes: ['http', 'https', 'mailto', 'tel'],
      allowedSchemesByTag: { img: ['http', 'https'] },
      allowProtocolRelative: false,
      transformTags: {
        a: (tagName, attribs) => ({
          tagName,
          attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' },
        }),
        img: (tagName, attribs) => {
          const next: Record<string, string> = { ...attribs };
          // Caminho relativo não abre fora do app: sem URL absoluta, a imagem sai.
          if (!/^https?:\/\//i.test(next.src ?? '')) delete next.src;
          for (const key of ['width', 'height'] as const) {
            const value = Number.parseInt(next[key] ?? '', 10);
            if (Number.isFinite(value) && value > 0) {
              next[key] = String(Math.min(value, 1200));
            } else {
              delete next[key];
            }
          }
          return { tagName, attribs: next };
        },
      },
      exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
    })
      // Parágrafo vazio do editor (<p></p>) é a linha em branco que o usuário
      // viu ao digitar; vazio, o cliente de e-mail o colapsa.
      .replace(/<p([^>]*)><\/p>/g, '<p$1><br /></p>')
  );
}

/** Acrescenta a tipografia inline depois da sanitização. */
function inlineStyles(html: string, accent: string): string {
  return html.replace(
    /<(p|h1|h2|h3|ul|ol|li|blockquote|hr|img|a)(\s[^>]*)?>/gi,
    (match, rawTag: string, rawAttrs: string | undefined) => {
      const tag = rawTag.toLowerCase();
      const attrs = rawAttrs ?? '';
      const base =
        tag === 'a'
          ? `color:${accent};text-decoration:underline;`
          : (INLINE_STYLES[tag] ?? '');
      const existing = /\sstyle="([^"]*)"/i.exec(attrs);
      if (existing) {
        return `<${tag}${attrs.replace(existing[0], ` style="${base}${existing[1]}"`)}>`;
      }
      const selfClosing = tag === 'hr' || tag === 'img';
      const cleanAttrs = selfClosing ? attrs.replace(/\s*\/$/, '') : attrs;
      return `<${tag}${cleanAttrs} style="${base}"${selfClosing ? ' /' : ''}>`;
    },
  );
}

/** Texto puro para a parte text/plain (e para clientes sem HTML). */
export function emailHtmlToText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h1|h2|h3|li|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(
      /<a\s[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi,
      (_m, href: string, label: string) =>
        label && label !== href ? `${label} (${href})` : href,
    );
  const text = sanitizeHtml(withBreaks, {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

const escape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export type LeadEmailBrand = {
  name: string;
  /** Absoluto (https). Sem logo, o nome da agência ocupa o cabeçalho. */
  logoUrl: string | null;
  primaryColor: string | null;
  website: string | null;
  phone: string | null;
};

export type LeadEmailOptions = {
  subject: string;
  /** Já sanitizado por `sanitizeEmailHtml`. */
  bodyHtml: string;
  brand: LeadEmailBrand;
  whatsapp: { url: string; label: string } | null;
};

function accentOf(color: string | null): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_ACCENT;
}

function websiteHref(website: string | null): string | null {
  const value = website?.trim();
  if (!value) return null;
  const href = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function renderLeadEmail(options: LeadEmailOptions): {
  html: string;
  text: string;
} {
  const accent = accentOf(options.brand.primaryColor);
  const name = escape(options.brand.name || 'Nossa equipe');
  const header = options.brand.logoUrl
    ? `<img src="${escape(options.brand.logoUrl)}" alt="${name}" height="40" style="display:block;height:40px;width:auto;max-width:200px;border:0;outline:none;text-decoration:none;" />`
    : `<span style="font-size:18px;font-weight:700;color:#0F172A;letter-spacing:-0.01em;">${name}</span>`;

  const whatsapp = options.whatsapp
    ? `
            <tr>
              <td style="padding:4px 40px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="border-radius:999px;background:${WHATSAPP_GREEN};">
                      <a href="${escape(options.whatsapp.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:14px;font-weight:600;line-height:1;color:#FFFFFF;text-decoration:none;border-radius:999px;">
                        ${escape(options.whatsapp.label)}
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`
    : '';

  const site = websiteHref(options.brand.website);
  const footerParts = [
    `<strong style="color:#475569;">${name}</strong>`,
    site
      ? `<a href="${escape(site)}" target="_blank" rel="noopener noreferrer" style="color:#64748B;text-decoration:none;">${escape(options.brand.website!.replace(/^https?:\/\//i, '').replace(/\/$/, ''))}</a>`
      : null,
    options.brand.phone ? escape(options.brand.phone) : null,
  ].filter(Boolean);

  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${escape(options.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#F1F5F9;-webkit-text-size-adjust:100%;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F1F5F9;">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="height:4px;line-height:4px;font-size:0;background:${accent};">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:28px 40px 20px;border-bottom:1px solid #F1F5F9;font-family:${FONT};">
                ${header}
              </td>
            </tr>
            <tr>
              <td style="padding:28px 40px 20px;font-family:${FONT};font-size:15px;line-height:1.65;color:#1E293B;">
                ${inlineStyles(options.bodyHtml, accent)}
              </td>
            </tr>${whatsapp}
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
            <tr>
              <td align="center" style="padding:18px 24px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#94A3B8;">
                ${footerParts.join(' &nbsp;·&nbsp; ')}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    emailHtmlToText(options.bodyHtml),
    options.whatsapp
      ? `${options.whatsapp.label}: ${options.whatsapp.url}`
      : null,
    '—',
    [options.brand.name, options.brand.website, options.brand.phone]
      .filter(Boolean)
      .join(' · '),
  ]
    .filter(Boolean)
    .join('\n\n');

  return { html, text };
}
