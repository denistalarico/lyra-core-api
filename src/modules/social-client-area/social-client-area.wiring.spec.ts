import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { ClientAreaBridgeRegistry } from '../../common/client-area-bridge/client-area-bridge.registry';
import { resolveMemberAccess } from '../client-area/client-area-permissions.catalog';
import type { ClientAreaContext } from '../client-area/client-area.types';
import { SocialClientAreaModule } from './social-client-area.module';

describe('CA10 real SocialClientAreaModule wiring', () => {
  it('registers the three Social scope adapters in the consumer registry during Nest init', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const ref = await Test.createTestingModule({
      imports: [SocialClientAreaModule],
    })
      .useMocker((token) =>
        token === getDataSourceToken('agency') ? { query } : undefined,
      )
      .compile();
    await ref.init();
    const registry = ref.get(ClientAreaBridgeRegistry);
    const context = {
      tenantId: randomUUID(),
      workspaceId: randomUUID(),
      agencyClientId: randomUUID(),
      companyContextId: randomUUID(),
      userId: randomUUID(),
      memberAccess: resolveMemberAccess(
        'client_member',
        {
          social_planner: true,
          social_creative_studio: true,
          social_campaigns: true,
        },
        {
          social_planner: 'viewer',
          social_creative_studio: 'viewer',
          social_campaigns: 'viewer',
        },
      ),
    } as ClientAreaContext;
    const id = randomUUID();
    for (const [module, routePath, params] of [
      ['social_planner', '/api/social/planner/plans/:planId', { planId: id }],
      [
        'social_creative_studio',
        '/api/social/creative-studio/assets/:id',
        { id },
      ],
      [
        'social_campaigns',
        '/api/social/campaigns/meta/alerts/:alertId/acknowledge',
        { alertId: id },
      ],
    ] as const)
      await registry.resolveScope(module, context, 'k', {
        method: module === 'social_campaigns' ? 'PATCH' : 'GET',
        routePath,
        params,
        query: {},
        body: null,
      });
    // Each module's adapter ran its own lookup; nothing matched, so all denied.
    expect(
      query.mock.calls.map(([sql]: [string]) => /FROM (\w+)/.exec(sql)![1]),
    ).toEqual([
      'social_plans',
      'social_creative_assets',
      'social_campaign_alerts',
    ]);
    await ref.close();
  });
});
