import { randomUUID } from 'node:crypto';
import type { ClientAreaSelfContext } from '../client-area/client-area.types';
import { ClientAreaOverviewService } from './client-area-overview.service';
import type { AnalyticsSourceInput } from './client-area-sources.registry';

describe('R2 Client Area self unified overview', () => {
  it('uses the separate Agency branch without fabricating a company scope', async () => {
    const read = jest
      .fn<Promise<{ total: number }>, [AnalyticsSourceInput]>()
      .mockResolvedValue({ total: 1 });
    const sources = { get: jest.fn().mockReturnValue({ modules: [], read }) };
    const service = new ClientAreaOverviewService(sources as never);
    const context: ClientAreaSelfContext = {
      surface: 'client_area',
      kind: 'agency_self',
      userId: randomUUID(),
      tenantId: randomUUID(),
      sessionId: randomUUID(),
      selfAccessId: randomUUID(),
      workspaceId: randomUUID(),
      agencyDisplayName: 'Lyra',
      role: 'client_admin',
      agencyRole: 'admin',
      permissions: new Set(),
      modules: { approvals: false, conversations: false },
    };

    await service.getSelf(context);

    const input = read.mock.calls[0][0];
    expect(input.scope).toBeUndefined();
    expect(input.context).toBeUndefined();
    expect(input.userId).toBe(context.userId);
    expect(input.agencyContext).toMatchObject({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      role: 'admin',
    });
  });
});
