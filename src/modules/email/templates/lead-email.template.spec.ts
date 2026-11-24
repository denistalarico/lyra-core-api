import {
  emailHtmlToText,
  renderLeadEmail,
  sanitizeEmailHtml,
} from './lead-email.template';
import { whatsappLink } from '../../agency/user-whatsapp-phone';

describe('sanitizeEmailHtml', () => {
  it('keeps the editor formatting and drops scripts, handlers and data images', () => {
    const html = sanitizeEmailHtml(
      '<p onclick="x()">Olá <strong>Maria</strong> <a href="javascript:alert(1)">x</a></p>' +
        '<script>alert(1)</script>' +
        '<img src="data:image/png;base64,AAAA" />' +
        '<img src="/api/assets/a.png" />' +
        '<p><a href="https://exemplo.test">site</a></p>',
    );

    expect(html).not.toMatch(/script|onclick|javascript|data:|\/api\/assets/);
    expect(html).toContain('<strong>Maria</strong>');
    expect(html).toContain(
      '<a href="https://exemplo.test" target="_blank" rel="noopener noreferrer">site</a>',
    );
  });

  it('keeps the size chosen in the editor as width/height attributes', () => {
    const html = sanitizeEmailHtml(
      '<img src="https://cdn.test/logo.png" width="180" height="60" style="position:fixed" />',
    );
    expect(html).toBe(
      '<img src="https://cdn.test/logo.png" width="180" height="60" />',
    );
  });

  it('turns empty editor paragraphs into visible blank lines', () => {
    expect(sanitizeEmailHtml('<p>a</p><p></p><p>b</p>')).toBe(
      '<p>a</p><p><br /></p><p>b</p>',
    );
  });
});

describe('renderLeadEmail', () => {
  const brand = {
    name: 'Agência Fictícia',
    logoUrl: 'https://cdn.test/logo.png',
    primaryColor: '#E11D48',
    website: 'agencia.test',
    phone: '(16) 3333-0000',
  };

  it('frames the body with the agency brand and the WhatsApp button', () => {
    const { html, text } = renderLeadEmail({
      subject: 'Proposta',
      bodyHtml: sanitizeEmailHtml(
        '<p>Olá!</p><p><a href="https://x.test">x</a></p>',
      ),
      brand,
      whatsapp: {
        url: 'https://wa.me/5516999998888',
        label: 'Falar no WhatsApp',
      },
    });

    expect(html).toContain('src="https://cdn.test/logo.png"');
    expect(html).toContain('background:#E11D48');
    expect(html).toContain('<p style="margin:0 0 12px;">Olá!</p>');
    expect(html).toContain('style="color:#E11D48;text-decoration:underline;"');
    expect(html).toContain('href="https://wa.me/5516999998888"');
    expect(html).toContain('href="https://agencia.test/"');
    expect(text).toContain('Olá!');
    expect(text).toContain('Falar no WhatsApp: https://wa.me/5516999998888');
  });

  it('falls back to the agency name and default accent without logo or color', () => {
    const { html } = renderLeadEmail({
      subject: 'Oi',
      bodyHtml: '<p>Oi</p>',
      brand: { ...brand, logoUrl: null, primaryColor: 'red', website: null },
      whatsapp: null,
    });

    expect(html).toContain('>Agência Fictícia</span>');
    expect(html).toContain('background:#2563EB');
    expect(html).not.toContain('wa.me');
  });
});

describe('emailHtmlToText', () => {
  it('keeps paragraphs, bullets and link targets', () => {
    expect(
      emailHtmlToText(
        '<p>Oi &amp; tchau</p><ul><li>um</li></ul><p><a href="https://x.test">site</a></p>',
      ),
    ).toBe('Oi & tchau\n• um\nsite (https://x.test)');
  });
});

describe('whatsappLink', () => {
  it('builds wa.me links with the Brazilian prefix and hides invalid numbers', () => {
    expect(whatsappLink('(16) 99999-8888')).toBe('https://wa.me/5516999998888');
    expect(whatsappLink('+1 415 555 0100')).toBe('https://wa.me/14155550100');
    expect(whatsappLink('123')).toBeNull();
    expect(whatsappLink(null)).toBeNull();
  });
});
