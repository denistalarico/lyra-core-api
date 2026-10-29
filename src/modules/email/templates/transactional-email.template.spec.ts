import { renderTransactionalEmail } from './transactional-email.template';

describe('renderTransactionalEmail brand', () => {
  it('keeps the Lyra logo without a brand', () => {
    const { html, text } = renderTransactionalEmail({ title: 'T', intro: 'I' });
    expect(html).toContain('/brand/suite-full-light.svg');
    expect(text).toContain('© Lyra Suite');
  });

  it('uses the tenant logo and name, escaped', () => {
    const { html, text } = renderTransactionalEmail({
      title: 'T',
      intro: 'I',
      brand: {
        name: 'A & "B"',
        logoUrl: 'https://api.example.com/api/assets/x.png',
      },
    });
    expect(html).toContain('src="https://api.example.com/api/assets/x.png"');
    expect(html).toContain('alt="A &amp; &quot;B&quot;"');
    expect(html).not.toContain('suite-full-light.svg');
    expect(text).toContain('© A & "B"');
  });

  it('falls back to the Lyra logo when the tenant has none', () => {
    const { html } = renderTransactionalEmail({
      title: 'T',
      intro: 'I',
      brand: { name: 'Tenant', logoUrl: null },
    });
    expect(html).toContain('/brand/suite-full-light.svg');
    expect(html).toContain('© Lyra Suite');
  });
});
