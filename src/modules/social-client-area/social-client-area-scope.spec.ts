import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ClientAreaBridgeRegistry } from '../../common/client-area-bridge/client-area-bridge.registry';
import { resolveMemberAccess } from '../client-area/client-area-permissions.catalog';
import type {
  ClientAreaAccessLevel,
  ClientAreaContext,
} from '../client-area/client-area.types';
import type { PermissionScopeRequest } from '../permissions/types/permission-context.types';
import { SocialClientAreaScopeService } from './social-client-area-scope.service';

const tenant = randomUUID(),
  workspace = randomUUID(),
  client = randomUUID(),
  company = randomUUID(),
  sibling = randomUUID(),
  user = randomUUID(),
  other = randomUUID();

type Fake = {
  table: string;
  client: string;
  company: string | null;
  creator: string | null;
  parent?: string | null;
  tenant?: string;
};

/** Answers by the table each SQL template reads, so the ref→table mapping is under test too. */
function fakeDb(rows: Record<string, Fake>) {
  const calls: string[] = [];
  return {
    calls,
    query: jest.fn((sql: string, [t, w, ids]: [string, string, string[]]) => {
      const table = /FROM (\w+)/.exec(sql)![1];
      calls.push(table);
      return Promise.resolve(
        ids.flatMap((id) => {
          const row = rows[id];
          return row &&
            row.table === table &&
            (row.tenant ?? tenant) === t &&
            w === workspace
            ? [
                {
                  id,
                  client: row.client,
                  company: row.company,
                  creator: row.creator,
                  parent: row.parent ?? null,
                },
              ]
            : [];
        }),
      );
    }),
  };
}

const context = (
  levels: Partial<
    Record<
      'social_planner' | 'social_creative_studio' | 'social_campaigns',
      ClientAreaAccessLevel
    >
  >,
  toggles: { ai?: boolean; media?: boolean } = {},
): ClientAreaContext => ({
  surface: 'client_area',
  userId: user,
  tenantId: tenant,
  workspaceId: workspace,
  sessionId: randomUUID(),
  membershipId: randomUUID(),
  agencyClientId: client,
  companyContextId: company,
  companyDisplayName: 'Empresa',
  role: 'client_member',
  permissions: new Set(),
  modules: { approvals: false, conversations: false },
  memberAccess: resolveMemberAccess(
    'client_member',
    Object.fromEntries(Object.keys(levels).map((key) => [key, true])),
    levels,
  ),
  allowAiCostActions: toggles.ai === true,
  allowMediaSpendActions: toggles.media === true,
});

const req = (
  method: string,
  routePath: string,
  parts: Partial<
    Pick<PermissionScopeRequest, 'params' | 'query' | 'body'>
  > = {},
): PermissionScopeRequest => ({
  method,
  routePath: `/api${routePath}`,
  params: parts.params ?? {},
  query: parts.query ?? {},
  body: parts.body ?? null,
});

describe('CA10 Social Client Area scope adapter', () => {
  const ownContent = randomUUID(),
    foreignAuthorContent = randomUUID(),
    siblingContent = randomUUID(),
    plan = randomUUID(),
    revision = randomUUID(),
    foreignRevision = randomUUID(),
    idea = randomUUID(),
    campaign = randomUUID(),
    connection = randomUUID();
  const rows: Record<string, Fake> = {
    [ownContent]: {
      table: 'social_content_items',
      client,
      company,
      creator: user,
      parent: plan,
    },
    [foreignAuthorContent]: {
      table: 'social_content_items',
      client,
      company,
      creator: other,
      parent: plan,
    },
    [siblingContent]: {
      table: 'social_content_items',
      client,
      company: sibling,
      creator: user,
    },
    [plan]: { table: 'social_plans', client, company, creator: other },
    [revision]: {
      table: 'social_content_revisions',
      client,
      company,
      creator: user,
      parent: ownContent,
    },
    [foreignRevision]: {
      table: 'social_content_revisions',
      client,
      company,
      creator: user,
      parent: foreignAuthorContent,
    },
    [idea]: { table: 'social_content_ideas', client, company, creator: other },
    [campaign]: {
      table: 'social_campaign_instances',
      client,
      company: sibling,
      creator: user,
    },
    [connection]: {
      table: 'social_ad_account_connections',
      client,
      company,
      creator: null,
    },
  };
  const service = (db = fakeDb(rows)) =>
    new SocialClientAreaScopeService(
      db as never,
      new ClientAreaBridgeRegistry(),
    );

  it('registers one resolver per Social module on init and delegates to it', async () => {
    const registry = new ClientAreaBridgeRegistry();
    const db = fakeDb(rows);
    new SocialClientAreaScopeService(db as never, registry).onModuleInit();
    const ctx = context({ social_planner: 'viewer' });
    await expect(
      registry.resolveScope(
        'social_planner',
        ctx,
        'social.planner.calendar.view.client',
        req('GET', '/social/planner/content/:contentId', {
          params: { contentId: ownContent },
        }),
      ),
    ).resolves.toMatchObject({ companyContextId: company, createdById: user });
    expect(db.calls).toEqual(['social_content_items']);
    // A route of another module never resolves through this module's slot.
    await expect(
      registry.resolveScope(
        'social_creative_studio',
        context({ social_creative_studio: 'manager' }),
        'social.planner.calendar.view.client',
        req('GET', '/social/planner/plans'),
      ),
    ).resolves.toBeNull();
    await expect(
      registry.resolveScope('leadflow_crm', ctx, 'x', req('GET', '/x')),
    ).resolves.toBeNull();
  });

  it('denies unknown templates, malformed ids and a sibling company of the same client', async () => {
    const adapter = service();
    const ctx = context({ social_planner: 'manager' });
    await expect(
      adapter.resolve(
        'social_planner',
        ctx,
        'k',
        req('DELETE', '/social/planner/content/:contentId', {
          params: { contentId: ownContent },
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      adapter.resolve(
        'social_planner',
        ctx,
        'k',
        req('GET', '/social/planner/content/:contentId', {
          params: { contentId: 'not-a-uuid' },
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      adapter.resolve(
        'social_planner',
        ctx,
        'k',
        req('GET', '/social/planner/content/:contentId', {
          params: { contentId: siblingContent },
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      adapter.resolve(
        'social_planner',
        ctx,
        'k',
        req('PATCH', '/social/planner/content/:contentId', {
          params: { contentId: ownContent },
          body: { campaignInstanceId: campaign },
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      adapter.resolve(
        'social_planner',
        ctx,
        'k',
        req('PATCH', '/social/planner/content/:contentId', {
          params: { contentId: ownContent },
          body: [] as never,
        }),
      ),
    ).resolves.toBeNull();
  });

  it('reports the real author so the evaluator applies Operator "own" grants', async () => {
    const adapter = service();
    const ctx = context({ social_planner: 'operator' });
    await expect(
      adapter.resolve(
        'social_planner',
        ctx,
        'k',
        req('PATCH', '/social/planner/content/:contentId', {
          params: { contentId: foreignAuthorContent },
        }),
      ),
    ).resolves.toMatchObject({ createdById: other });
    await expect(
      adapter.resolve(
        'social_planner',
        ctx,
        'k',
        req('POST', '/social/planner/content/batch/archive', {
          body: { contentIds: [ownContent, foreignAuthorContent] },
        }),
      ),
    ).resolves.toMatchObject({ createdById: other });
    await expect(
      adapter.resolve(
        'social_planner',
        ctx,
        'k',
        req('POST', '/social/planner/content/batch/archive', {
          body: { contentIds: [ownContent] },
        }),
      ),
    ).resolves.toMatchObject({ createdById: user });
    // Create key acting on an existing row: Operator only on their own idea.
    await expect(
      adapter.resolve(
        'social_planner',
        ctx,
        'k',
        req('POST', '/social/planner/ideas/:ideaId/convert', {
          params: { ideaId: idea },
          body: { planId: plan },
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      adapter.resolve(
        'social_planner',
        context({ social_planner: 'manager' }),
        'k',
        req('POST', '/social/planner/ideas/:ideaId/convert', {
          params: { ideaId: idea },
          body: { planId: plan },
        }),
      ),
    ).resolves.toMatchObject({ createdById: other });
  });

  it('requires nested ids to belong to the addressed row', async () => {
    const adapter = service();
    const ctx = context({ social_planner: 'manager' });
    const restore = (revisionId: string) =>
      adapter.resolve(
        'social_planner',
        ctx,
        'k',
        req(
          'POST',
          '/social/planner/content/:contentId/revisions/:revisionId/restore',
          { params: { contentId: ownContent, revisionId } },
        ),
      );
    await expect(restore(revision)).resolves.toMatchObject({
      createdById: user,
    });
    await expect(restore(foreignRevision)).resolves.toBeNull();
  });

  it('answers 403 for Manager-only actions and for cost actions without the D-13 toggle', async () => {
    const adapter = service();
    const generate = (ctx: ClientAreaContext) =>
      adapter.resolve(
        'social_planner',
        ctx,
        'k',
        req('POST', '/social/planner/plans/:planId/generate', {
          params: { planId: plan },
        }),
      );
    await expect(
      generate(context({ social_planner: 'operator' }, { ai: true })),
    ).rejects.toThrow('Insufficient module level.');
    const off = generate(context({ social_planner: 'manager' }));
    await expect(off).rejects.toBeInstanceOf(ForbiddenException);
    await expect(off).rejects.toMatchObject({
      response: { code: 'client_area_cost_action_disabled' },
    });
    await expect(
      generate(context({ social_planner: 'manager' }, { ai: true })),
    ).resolves.toMatchObject({ companyContextId: company });
    // Scope first: a foreign plan is 404 even with every toggle off.
    await expect(
      adapter.resolve(
        'social_planner',
        context({ social_planner: 'manager' }),
        'k',
        req('POST', '/social/planner/plans/:planId/generate', {
          params: { planId: siblingContent },
        }),
      ),
    ).resolves.toBeNull();
    const budget = (media: boolean) =>
      adapter.resolve(
        'social_campaigns',
        context({ social_campaigns: 'manager' }, { media }),
        'k',
        req('POST', '/social/campaigns/meta/actions/budget/preflight', {
          body: { connectionId: connection },
        }),
      );
    await expect(budget(false)).rejects.toMatchObject({
      response: { code: 'client_area_cost_action_disabled' },
    });
    await expect(budget(true)).resolves.toMatchObject({
      companyContextId: company,
    });
  });

  it('checks the ad connection named in the query on read routes', async () => {
    const adapter = service();
    const ctx = context({ social_campaigns: 'viewer' });
    await expect(
      adapter.resolve(
        'social_campaigns',
        ctx,
        'k',
        req('GET', '/social/campaigns/meta/hierarchy', {
          query: { connectionId: connection },
        }),
      ),
    ).resolves.toMatchObject({ companyContextId: company });
    await expect(
      adapter.resolve(
        'social_campaigns',
        ctx,
        'k',
        req('GET', '/social/campaigns/meta/hierarchy', {
          query: { connectionId: randomUUID() },
        }),
      ),
    ).resolves.toBeNull();
  });
});
