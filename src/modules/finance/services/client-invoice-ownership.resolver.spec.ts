import { resolveClientInvoiceOwnership } from './client-invoice-ownership.resolver';
describe('CA9 canonical invoice ownership', () => {
  it('maps only unambiguous IDs, including legacy and company contacts, never display names', async () => {
    const clients = [
      {
        id: 'a',
        contactId: 'contact-a',
        metadata: { contactId: 'legacy-a' },
        displayName: 'Same',
      },
      { id: 'b', contactId: 'shared', metadata: {}, displayName: 'Same' },
    ];
    const companies = [
      { agencyClientId: 'a', companyContactId: 'company-a' },
      { agencyClientId: 'a', companyContactId: 'shared' },
      { agencyClientId: 'a', companyContactId: 'b' },
    ];
    const owners = await resolveClientInvoiceOwnership(
      { find: () => Promise.resolve(clients) } as never,
      { find: () => Promise.resolve(companies) } as never,
      { tenantId: 't', workspaceId: 'w' },
    );
    expect([...owners]).toEqual([
      ['contact-a', 'a'],
      ['legacy-a', 'a'],
      ['company-a', 'a'],
    ]);
    expect(owners.has('shared')).toBe(false);
    expect(owners.has('Same')).toBe(false);
  });
});
