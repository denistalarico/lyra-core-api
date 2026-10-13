import {
  isHttpsUrl,
  renderContractSigningEmail,
} from './contract-signing-email';

describe('renderContractSigningEmail', () => {
  it('puts the signing link in the button and escapes user data', () => {
    const email = renderContractSigningEmail({
      signerName: 'Ana <b>',
      contractTitle: 'Contrato & Co',
      agencyName: 'Talarico Labs',
      url: 'https://assina.ae/abc?x=1&y=2',
    });
    expect(email.subject).toBe('Contrato para assinar: Contrato & Co');
    expect(email.html).toContain('href="https://assina.ae/abc?x=1&amp;y=2"');
    expect(email.html).toContain('Ana &lt;b&gt;');
    expect(email.html).toContain('Contrato &amp; Co');
    expect(email.text).toContain('Assinar: https://assina.ae/abc?x=1&y=2');
  });

  it('accepts only https links', () => {
    expect(isHttpsUrl('https://assina.ae/abc')).toBe(true);
    expect(isHttpsUrl('http://assina.ae/abc')).toBe(false);
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false);
  });
});
