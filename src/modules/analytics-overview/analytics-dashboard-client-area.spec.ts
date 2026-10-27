import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { LeadFlowAnalyticsDashboardsService } from '../leadflow-analytics/dashboards/leadflow-analytics-dashboards.service';
import { SocialAnalyticsDashboardsService } from '../social-analytics-dashboards/social-analytics-dashboards.service';
import { analyticsDashboardPrincipal } from './analytics-dashboard-client-area.policy';

const scope: CompanyAwareScope = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  agencyClientId: '30000000-0000-4000-8000-000000000001',
  companyContextId: '31000000-0000-4000-8000-000000000001',
};
const ownerA = '50000000-0000-4000-8000-00000000000a';
const ownerB = '50000000-0000-4000-8000-00000000000b';
const client = { clientAreaUserId: ownerA };

type Row = {
  id: string;
  name: string;
  isDefault: boolean;
  channelKey: string | null;
  clientAreaOwnerUserId: string | null;
  channels: string[];
  layout: { version: number; sections: unknown[] };
  createdAt: Date;
  updatedAt: Date;
};
const row = (overrides: Partial<Row> = {}): Row => ({
  id: '40000000-0000-4000-8000-000000000001',
  name: 'Painel',
  isDefault: false,
  channelKey: null,
  clientAreaOwnerUserId: null,
  channels: [],
  layout: { version: 1, sections: [] },
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  ...overrides,
});

const products = [
  {
    name: 'Social',
    channel: 'instagram',
    build: (repository: unknown) =>
      new SocialAnalyticsDashboardsService(repository as never),
  },
  {
    name: 'LeadFlow',
    channel: 'service',
    build: (repository: unknown) =>
      new LeadFlowAnalyticsDashboardsService(repository as never),
  },
] as const;

describe.each(products)(
  'CA-AN1 $name dashboards for the Client Area principal',
  ({ build, channel }) => {
    const setup = (found: Row | null, count = 0) => {
      const repository = {
        find: jest.fn().mockResolvedValue(found ? [found] : []),
        findOne: jest.fn().mockResolvedValue(found),
        count: jest.fn().mockResolvedValue(count),
        create: jest.fn((input: unknown) => input),
        save: jest.fn((entity: Row) =>
          Promise.resolve({
            ...entity,
            id: entity.id ?? '40000000-0000-4000-8000-0000000000ff',
            createdAt: entity.createdAt ?? new Date(),
            updatedAt: new Date(),
          }),
        ),
        remove: jest.fn().mockResolvedValue(undefined),
      };
      return { service: build(repository), repository };
    };

    it('reads the principal from the Bridge context only', () => {
      expect(analyticsDashboardPrincipal({})).toEqual({
        clientAreaUserId: null,
      });
      expect(
        analyticsDashboardPrincipal({ clientAreaContext: { userId: ownerA } }),
      ).toEqual({ clientAreaUserId: ownerA });
    });

    it('lists shared rows for the Agency, shared + own for the Owner, and flags ownedByMe', async () => {
      const { service, repository } = setup(
        row({ clientAreaOwnerUserId: ownerA }),
      );
      await service.list(scope, null);
      const agencyWhere = (
        repository.find.mock.calls.at(-1) as [{ where: unknown[] }]
      )[0].where;
      expect(agencyWhere).toHaveLength(1);
      expect(
        (agencyWhere[0] as Record<string, unknown>).clientAreaOwnerUserId,
      ).toBeInstanceOf(IsNull().constructor);

      const views = await service.list(scope, ownerA, client);
      const clientWhere = (
        repository.find.mock.calls.at(-1) as [{ where: unknown[] }]
      )[0].where as Record<string, unknown>[];
      expect(clientWhere).toHaveLength(2);
      expect(clientWhere[1].clientAreaOwnerUserId).toBe(ownerA);
      expect(views[0].ownedByMe).toBe(true);
      expect(JSON.stringify(views)).not.toContain(ownerA);
    });

    it('creates the Owner a private row, limited to 20 per Owner', async () => {
      const { service, repository } = setup(null, 0);
      const created = await service.create(
        scope,
        ownerA,
        { name: 'Meu', channels: [channel] } as never,
        client,
      );
      expect(created.ownedByMe).toBe(true);
      expect(repository.save.mock.calls.at(-1)![0]).toMatchObject({
        clientAreaOwnerUserId: ownerA,
        isDefault: false,
      });
      expect(
        (repository.count.mock.calls.at(-1) as unknown[])[0],
      ).toMatchObject({
        where: { clientAreaOwnerUserId: ownerA },
      });

      const full = setup(null, 20);
      await expect(
        full.service.create(
          scope,
          ownerA,
          { name: 'Mais um', channels: [channel] } as never,
          client,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      // The Agency's 40 count shared rows only: 20 is fine there.
      await expect(
        full.service.create(scope, null, {
          name: 'Da agência',
          channels: [channel],
        } as never),
      ).resolves.toMatchObject({ ownedByMe: false });
    });

    it('refuses the Visão Geral to the Client Area with analytics_overview_agency_owned', async () => {
      const { service } = setup(row({ isDefault: true }));
      for (const action of [
        () =>
          service.update(
            scope,
            'id',
            { layout: { version: 1, sections: [] } } as never,
            client,
          ),
        () => service.remove(scope, 'id', client),
      ])
        await expect(action()).rejects.toMatchObject({
          response: { code: 'analytics_overview_agency_owned' },
        });
    });

    it('lets the Owner change only the layout of a channel screen', async () => {
      const { service } = setup(row({ channelKey: channel, name: 'Canal' }));
      await expect(
        service.update(
          scope,
          'id',
          { layout: { version: 1, sections: [] } } as never,
          client,
        ),
      ).resolves.toMatchObject({ channelKey: channel });
      await expect(
        service.update(scope, 'id', { description: 'x' } as never, client),
      ).rejects.toMatchObject({
        response: { code: 'analytics_dashboard_agency_owned' },
      });
      await expect(service.remove(scope, 'id', client)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("refuses an agency-made company dashboard; edits and deletes the Owner's own", async () => {
      const shared = setup(row());
      await expect(
        shared.service.update(scope, 'id', { name: 'Novo' } as never, client),
      ).rejects.toMatchObject({
        response: { code: 'analytics_dashboard_agency_owned' },
      });
      const own = setup(row({ clientAreaOwnerUserId: ownerA }));
      await expect(
        own.service.update(scope, 'id', { name: 'Novo' } as never, client),
      ).resolves.toMatchObject({ name: 'Novo', ownedByMe: true });
      await expect(
        own.service.remove(scope, 'id', client),
      ).resolves.toBeUndefined();
    });

    it("looks rows up with the owner filter, so another Owner's row is absent", async () => {
      const { service, repository } = setup(null);
      await expect(
        service.remove(scope, 'id', { clientAreaUserId: ownerB }),
      ).rejects.toThrow('Dashboard não encontrado');
      const where = (
        repository.findOne.mock.calls.at(-1) as [
          { where: Record<string, unknown>[] },
        ]
      )[0].where;
      expect(where.map((entry) => entry.clientAreaOwnerUserId)).toEqual([
        expect.any(IsNull().constructor),
        ownerB,
      ]);
    });

    it('keeps the Agency unrestricted on shared rows', async () => {
      const { service } = setup(row({ channelKey: channel, name: 'Canal' }));
      await expect(
        service.update(scope, 'id', { description: 'x' } as never),
      ).resolves.toMatchObject({ ownedByMe: false });
    });
  },
);
