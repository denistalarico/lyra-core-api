import { leadFlowClientAreaRoute } from './leadflow-client-area.routes';
import { leadFlowClientResponse } from './leadflow-client-area.interceptor';
import { assertClientAreaMediaIntent } from './leadflow-client-media-intent';

describe('CA11.1 same JSON as the Agency, minus company/developer scope', () => {
  it('returns the Agency serializer output unchanged for ordinary resources', () => {
    const conversation = {
      id: 'a',
      title: 'Lead',
      metadata: { contactName: 'Maria', contactAvatarUrl: 'https://img' },
      assignedUserId: 'u',
    };
    expect(
      leadFlowClientResponse(
        conversation,
        leadFlowClientAreaRoute('GET', '/inbox/conversations/:id')!,
      ),
    ).toEqual(conversation);
    const opportunity = { id: 'o', createdByUserId: 'u', metadata: { x: 1 } };
    expect(
      leadFlowClientResponse(
        { items: [opportunity], total: 1 },
        leadFlowClientAreaRoute('GET', '/crm/opportunities')!,
      ),
    ).toEqual({ items: [opportunity], total: 1 });
    const agent = {
      id: 'agent',
      behaviorConfig: { tone: ['friendly'], custom: 'kept' },
      channelPolicy: {
        allowedChannels: ['whatsapp'],
        channelActivationPolicies: { c: { trigger: 'always' } },
      },
      handoffPolicy: { targetUserIds: ['agency-user'] },
      promptConfig: { clientPromptConfigRef: 'ref' },
    };
    expect(
      leadFlowClientResponse(
        agent,
        leadFlowClientAreaRoute('GET', '/leadflow/agents/:id')!,
      ),
    ).toEqual(agent);
  });
  it('removes workspace Activities from the Agenda aggregate', () => {
    expect(
      leadFlowClientResponse(
        {
          version: 'v1',
          mode: 'canonical',
          items: [
            { source: 'activity', sourceId: 'foreign', title: 'Secret' },
            { source: 'scheduled_item', sourceId: 'own', title: 'Meeting' },
          ],
        },
        leadFlowClientAreaRoute('GET', '/leadflow/agenda/v1/items')!,
      ),
    ).toEqual({
      version: 'v1',
      mode: 'canonical',
      items: [{ source: 'scheduled_item', sourceId: 'own', title: 'Meeting' }],
    });
  });
  it('removes the agency contact graph from contact detail and list rows', () => {
    const detail = leadFlowClientResponse(
      {
        contact: { id: 'a', displayName: 'Lead' },
        profile: { avatarUrl: 'avatar' },
        methods: [{ type: 'email', value: 'lead@example.test' }],
        addresses: [],
        tags: [{ name: 'Agency tag' }],
        bankAccounts: [{ iban: 'secret' }],
        banks: [{ name: 'secret' }],
        relatedContacts: [{ displayName: 'Other' }],
        relatedCompanies: [{ displayName: 'Other' }],
      },
      leadFlowClientAreaRoute(
        'GET',
        '/agency/contacts/leadflow/company-contacts/:contactId',
      )!,
    );
    expect(detail).toEqual({
      contact: { id: 'a', displayName: 'Lead' },
      profile: { avatarUrl: 'avatar' },
      methods: [{ type: 'email', value: 'lead@example.test' }],
      addresses: [],
    });
    expect(
      leadFlowClientResponse(
        {
          items: [
            {
              id: 'a',
              avatarUrl: 'avatar',
              tags: [{ name: 'Agency tag' }],
              relatedCompanies: [{ displayName: 'Other' }],
            },
          ],
          total: 1,
        },
        leadFlowClientAreaRoute(
          'GET',
          '/agency/contacts/leadflow/company-contacts',
        )!,
      ),
    ).toEqual({ items: [{ id: 'a', avatarUrl: 'avatar' }], total: 1 });
  });
  it('detaches internal contacts and keeps developer material on the Agency side', () => {
    expect(
      leadFlowClientResponse(
        { id: 'c', contactId: 'team', qualificationStatus: 'internal' },
        leadFlowClientAreaRoute('GET', '/inbox/conversations/:id')!,
      ),
    ).toMatchObject({ contactId: null });
    expect(
      leadFlowClientResponse(
        {
          id: 'agent',
          promptConfig: {
            clientPromptConfigRef: 'ref',
            developerOverrides: { systemPrompt: 'secret' },
          },
        },
        leadFlowClientAreaRoute('GET', '/leadflow/agents/:id')!,
      ),
    ).toEqual({ id: 'agent', promptConfig: { clientPromptConfigRef: 'ref' } });
    expect(
      leadFlowClientResponse(
        {
          businessModeKey: 'a',
          fields: [
            { key: 'title', label: 'Title', options: [{ value: 'a' }] },
            { key: 'raw', developerOnly: true },
          ],
        },
        leadFlowClientAreaRoute('GET', '/crm/opportunity-fields')!,
      ),
    ).toEqual({
      businessModeKey: 'a',
      fields: [{ key: 'title', label: 'Title', options: [{ value: 'a' }] }],
    });
  });
  it('applies the conversation rule inside the canonical outbound envelope', () => {
    expect(
      leadFlowClientResponse(
        {
          ok: true,
          conversation: {
            id: 'c',
            contactId: 'team',
            qualificationStatus: 'internal',
          },
          message: { id: 'm', content: 'Reply' },
        },
        leadFlowClientAreaRoute('POST', '/inbox/channels/whatsapp/send-text')!,
      ),
    ).toEqual({
      ok: true,
      conversation: {
        id: 'c',
        contactId: null,
        qualificationStatus: 'internal',
      },
      message: { id: 'm', content: 'Reply' },
    });
  });
  it('binds a parsed upload to the company/conversation checked before Multer and preserves Agency calls', () => {
    const ctx = { tenantId: 'tenant', role: 'client_area_actor' };
    expect(() =>
      assertClientAreaMediaIntent(
        ctx,
        { conversationId: 'b', channelId: 'channel', to: 'lead' },
        'a',
        'channel',
        'lead',
      ),
    ).toThrow();
    expect(() =>
      assertClientAreaMediaIntent(
        ctx,
        { conversationId: 'a', channelId: 'channel', to: 'lead' },
        'a',
        'channel',
        'lead',
      ),
    ).not.toThrow();
    expect(() =>
      assertClientAreaMediaIntent(
        { tenantId: 'tenant', role: 'manager' },
        { conversationId: 'a' },
      ),
    ).not.toThrow();
  });
});
