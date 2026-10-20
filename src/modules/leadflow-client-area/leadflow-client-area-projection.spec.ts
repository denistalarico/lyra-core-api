import { leadFlowClientAreaRoute } from './leadflow-client-area.routes';
import { leadFlowClientResponse } from './leadflow-client-area.interceptor';
import { assertClientAreaMediaIntent } from './leadflow-client-media-intent';

describe('CA11 field-by-field projection and multipart intent', () => {
  it('never leaks channel credentials, internal metadata, contact finance or related companies', () => {
    const channel = leadFlowClientResponse(
      {
        id: 'a',
        name: 'Inbox',
        accessTokenEncrypted: 'secret',
        metadata: { token: 'secret' },
        tenantId: 'tenant',
      },
      leadFlowClientAreaRoute('GET', '/inbox/channels')!,
    );
    expect(channel).toEqual({ id: 'a', name: 'Inbox' });
    const contact = leadFlowClientResponse(
      {
        contact: { id: 'a', displayName: 'Lead', tenantId: 'tenant' },
        bankAccounts: [{ iban: 'secret' }],
        relatedCompanies: [{ displayName: 'Other' }],
        profile: { avatarUrl: 'avatar', document: 'secret' },
        methods: [
          {
            type: 'email',
            value: 'lead@example.test',
            workspaceId: 'workspace',
          },
        ],
      },
      leadFlowClientAreaRoute(
        'GET',
        '/agency/contacts/leadflow/company-contacts/:contactId',
      )!,
    );
    expect(JSON.stringify(contact)).not.toMatch(
      /secret|tenant|workspace|Other/,
    );
    expect(contact).toMatchObject({
      contact: { id: 'a', displayName: 'Lead' },
      methods: [{ type: 'email', value: 'lead@example.test' }],
    });
  });
  it('removes workspace Activities from the Agenda aggregate and nested developer config from agents', () => {
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
    ).toMatchObject({ items: [{ sourceId: 'own', title: 'Meeting' }] });
    const result = leadFlowClientResponse(
      {
        id: 'agent',
        metadata: { token: 'secret' },
        promptConfig: { developerOverrides: { systemPrompt: 'secret' } },
        behaviorConfig: {
          tone: 'friendly',
          token: 'secret',
          language: { token: 'secret' },
        },
        channels: [
          {
            id: 'binding',
            channelKey: 'whatsapp',
            config: { token: 'secret' },
          },
        ],
      },
      leadFlowClientAreaRoute('GET', '/leadflow/agents/:id')!,
    );
    expect(JSON.stringify(result)).not.toContain('secret');
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
  it('preserves CRM catalog wrappers and safe options without developer fields', () => {
    expect(
      leadFlowClientResponse(
        {
          businessModeKey: 'a',
          businessModeResolved: true,
          fields: [
            {
              key: 'title',
              label: 'Title',
              type: 'text',
              options: [{ value: 'a', label: 'A', metadata: 'secret' }],
            },
            { key: 'tenantId', developerOnly: true },
          ],
        },
        leadFlowClientAreaRoute('GET', '/crm/opportunity-fields')!,
      ),
    ).toEqual({
      businessModeKey: 'a',
      businessModeResolved: true,
      fields: [
        {
          key: 'title',
          label: 'Title',
          type: 'text',
          options: [{ value: 'a', label: 'A' }],
        },
      ],
    });
    expect(
      leadFlowClientResponse(
        {
          businessMode: 'a',
          reasons: [
            {
              code: 'lost',
              label: 'Lost',
              scope: 'shared',
              metadata: 'secret',
            },
          ],
        },
        leadFlowClientAreaRoute('GET', '/crm/loss-reasons')!,
      ),
    ).toEqual({
      businessMode: 'a',
      reasons: [{ code: 'lost', label: 'Lost', scope: 'shared' }],
    });
  });
  it('preserves the canonical outbound conversation/message envelope without provider metadata', () => {
    expect(
      leadFlowClientResponse(
        {
          conversation: { id: 'conversation', tenantId: 'secret' },
          message: {
            id: 'message',
            senderUserId: 'client-person',
            content: 'Reply',
            metadata: { token: 'secret' },
          },
          meta: { accessToken: 'secret' },
        },
        leadFlowClientAreaRoute('POST', '/inbox/channels/whatsapp/send-text')!,
      ),
    ).toEqual({
      conversation: { id: 'conversation', metadata: {} },
      message: {
        id: 'message',
        senderUserId: 'client-person',
        content: 'Reply',
      },
    });
  });
});
