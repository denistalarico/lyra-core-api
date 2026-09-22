import { BadRequestException, ConflictException } from '@nestjs/common';
import { IsNull, QueryFailedError } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { DASHBOARD_LAYOUT_VERSION } from './dashboard-layout.contract';
import type { SocialAnalyticsDashboardEntity } from './entities';
import {
  SEEDED_CHANNEL_DASHBOARDS,
  SocialAnalyticsDashboardsService,
} from './social-analytics-dashboards.service';

const scope: CompanyAwareScope = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  agencyClientId: '30000000-0000-4000-8000-000000000001',
  companyContextId: '31000000-0000-4000-8000-000000000001',
};

function dashboard(
  overrides: Partial<SocialAnalyticsDashboardEntity> = {},
): SocialAnalyticsDashboardEntity {
  return {
    id: '40000000-0000-4000-8000-000000000001',
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    agencyClientId: scope.agencyClientId,
    companyContextId: scope.companyContextId,
    name: 'Desempenho mensal',
    isDefault: false,
    channelKey: null,
    channels: ['meta_ads'],
    layout: { version: DASHBOARD_LAYOUT_VERSION, sections: [] },
    createdById: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  } as SocialAnalyticsDashboardEntity;
}

function buildService(rows: SocialAnalyticsDashboardEntity[] = []) {
  const repository = {
    find: jest.fn().mockResolvedValue(rows),
    findOne: jest.fn().mockResolvedValue(rows[0] ?? null),
    count: jest.fn().mockResolvedValue(rows.length),
    create: jest.fn((input: unknown) => input),
    // Mirrors what the real repository returns: `@CreateDateColumn` and
    // `@UpdateDateColumn` are populated on the way back, and `toView` reads
    // them.
    save: jest.fn((entity: SocialAnalyticsDashboardEntity) =>
      Promise.resolve({
        ...entity,
        id: entity.id ?? '40000000-0000-4000-8000-0000000000ff',
        createdAt: entity.createdAt ?? new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: entity.updatedAt ?? new Date('2026-09-02T00:00:00.000Z'),
      }),
    ),
    remove: jest.fn().mockResolvedValue(undefined),
  };

  const service = new SocialAnalyticsDashboardsService(repository as never);

  return { service, repository };
}

describe('SocialAnalyticsDashboardsService', () => {
  describe('update', () => {
    it('leaves absent fields alone', async () => {
      // `feedback_dto_spread_undefined_overwrite`: an absent key in a PATCH
      // means "do not touch", and `Object.assign(entity, { ...dto })` would
      // write undefined over the column instead. The layout autosave sends
      // `layout` alone, so this is the path that would blank every name.
      const existing = dashboard({ name: 'Nome original' });
      const { service, repository } = buildService([existing]);

      const layout = {
        version: DASHBOARD_LAYOUT_VERSION,
        sections: [
          {
            id: 's',
            channel: 'meta_ads',
            title: 'Meta Ads',
            cards: [{ id: 'c', kind: 'kpi', size: { w: 3, h: 1 } }],
          },
        ],
      };

      await service.update(scope, existing.id, { layout });

      const saved = repository.save.mock.calls[0][0];

      expect(saved.name).toBe('Nome original');
      expect(saved.channels).toEqual(['meta_ads']);
      expect(saved.layout.sections).toHaveLength(1);
    });

    it('trims the name and refuses a blank one', async () => {
      const existing = dashboard();
      const { service, repository } = buildService([existing]);

      await service.update(scope, existing.id, { name: '  Novo nome  ' });
      expect(repository.save.mock.calls[0][0].name).toBe('Novo nome');

      await expect(
        service.update(scope, existing.id, { name: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a malformed layout instead of storing it', async () => {
      const existing = dashboard();
      const { service, repository } = buildService([existing]);

      await expect(
        service.update(scope, existing.id, { layout: { version: 99 } }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(repository.save).not.toHaveBeenCalled();
    });

    it('reports a name collision as a conflict', async () => {
      const existing = dashboard();
      const { service, repository } = buildService([existing]);

      const violation = new QueryFailedError('', [], new Error('duplicate'));
      (violation as QueryFailedError & { code?: string }).code = '23505';
      repository.save.mockRejectedValueOnce(violation);

      await expect(
        service.update(scope, existing.id, { name: 'Visão Geral' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('remove', () => {
    it('refuses to delete the built-in dashboard', async () => {
      // The frontend routes to it whenever nothing else is selected, and the
      // next read would seed it straight back.
      const builtIn = dashboard({ isDefault: true, name: 'Visão Geral' });
      const { service, repository } = buildService([builtIn]);

      await expect(service.remove(scope, builtIn.id)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repository.remove).not.toHaveBeenCalled();
    });

    it('deletes a saved one', async () => {
      const saved = dashboard();
      const { service, repository } = buildService([saved]);

      await service.remove(scope, saved.id);
      expect(repository.remove).toHaveBeenCalledWith(saved);
    });
  });

  describe('create', () => {
    it('normalizes channels to catalog order', async () => {
      // Two dashboards with the same channels must lay out identically,
      // whatever order the checkboxes were ticked in.
      const { service, repository } = buildService([]);

      await service.create(scope, null, {
        name: 'Novo',
        channels: ['instagram', 'facebook'],
      });

      const saved = repository.save.mock.calls[0][0];

      expect(saved.channels).toEqual(['facebook', 'instagram']);
      expect(saved.layout.sections.map((s) => s.channel)).toEqual([
        'facebook',
        'instagram',
      ]);
      expect(saved.isDefault).toBe(false);
    });

    it('never creates a second default', async () => {
      const { service, repository } = buildService([]);

      await service.create(scope, null, {
        name: 'Novo',
        channels: ['meta_ads'],
      });

      expect(repository.save.mock.calls[0][0].isDefault).toBe(false);
    });
  });

  describe('scope isolation', () => {
    it('queries with IsNull for an agency-scoped context', async () => {
      // A plain `null` in a TypeORM `where` is not `IS NULL`, and would make
      // the agency's own dashboards invisible to the agency.
      const { service, repository } = buildService([
        dashboard({ isDefault: true }),
      ]);

      await service.list(
        {
          ...scope,
          agencyClientId: null,
          companyContextId: null,
        },
        null,
      );

      const [options] = repository.find.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      const where = options.where;

      expect(where.agencyClientId).toBeInstanceOf(IsNull().constructor);
      expect(where.companyContextId).toBeInstanceOf(IsNull().constructor);
      expect(where.tenantId).toBe(scope.tenantId);
    });
  });

  describe('list', () => {
    it('seeds the built-in dashboard when the context has none', async () => {
      const { service, repository } = buildService([]);
      repository.findOne.mockResolvedValue(null);

      await service.list(scope, null);

      const seeded = repository.save.mock.calls[0][0];

      expect(seeded.isDefault).toBe(true);
      expect(seeded.name).toBe('Visão Geral');
      expect(seeded.companyContextId).toBe(scope.companyContextId);
    });

    it('survives losing the race to seed it', async () => {
      // Two operators opening Analytics at once both see no default and both
      // insert; the partial unique index makes the loser's insert fail, and
      // that must not surface as an error.
      const { service, repository } = buildService([]);
      repository.findOne.mockResolvedValue(null);

      const violation = new QueryFailedError('', [], new Error('duplicate'));
      (violation as QueryFailedError & { code?: string }).code = '23505';
      repository.save.mockRejectedValueOnce(violation);

      await expect(service.list(scope, null)).resolves.toEqual([]);
    });

    it('does not seed when everything already exists', async () => {
      const rows = [
        dashboard({ isDefault: true, name: 'Visão Geral' }),
        ...SEEDED_CHANNEL_DASHBOARDS.map((entry, index) =>
          dashboard({
            id: `4000000a-0000-4000-8000-00000000000${index}`,
            name: entry.name,
            channelKey: entry.channel,
            channels: [entry.channel],
          }),
        ),
      ];
      const { service, repository } = buildService(rows);
      repository.findOne.mockResolvedValue(rows[0]);

      await service.list(scope, null);

      expect(repository.save).not.toHaveBeenCalled();
    });

    it('seeds one editable screen per integrated channel', async () => {
      // The channel tabs are screens of their own, not a filter over whichever
      // dashboard is open. Each is a row so it can hold its own layout.
      const { service, repository } = buildService([]);
      repository.findOne.mockResolvedValue(null);

      await service.list(scope, null);

      const seededChannels = repository.save.mock.calls
        .map(([entity]) => (entity as SocialAnalyticsDashboardEntity).channelKey)
        .filter(Boolean);

      expect(seededChannels).toEqual(['facebook', 'instagram', 'meta_ads']);

      // Google Ads is not seeded: the integration does not exist, and a tab
      // that can only say "not integrated" is a promise the product does not
      // keep.
      expect(seededChannels).not.toContain('google_ads');
    });

    it('does not promote an operator-made dashboard into a channel screen', async () => {
      // A dashboard the operator called "Facebook", or any single-channel one
      // they built, must keep its name and stay deletable. The distinction is
      // the column, never the name or the channel list.
      const handMade = dashboard({
        name: 'Facebook',
        channelKey: null,
        channels: ['facebook'],
      });
      const { service, repository } = buildService([
        dashboard({ isDefault: true, name: 'Visão Geral' }),
        handMade,
      ]);
      repository.findOne.mockResolvedValue(null);

      const listed = await service.list(scope, null);

      expect(
        listed.find((item) => item.id === handMade.id)?.channelKey,
      ).toBeNull();
    });

    it('orders the strip: Visão Geral, the channels, then the rest', async () => {
      // Seeding races in a fresh scope, so creation order would let two
      // operators see differently ordered tabs for the same context.
      const rows = [
        dashboard({ id: 'r-custom', name: 'Meu painel' }),
        dashboard({
          id: 'r-meta',
          name: 'Meta Ads',
          channelKey: 'meta_ads',
          channels: ['meta_ads'],
        }),
        dashboard({ id: 'r-default', isDefault: true, name: 'Visão Geral' }),
        dashboard({
          id: 'r-face',
          name: 'Facebook',
          channelKey: 'facebook',
          channels: ['facebook'],
        }),
      ];
      const { service, repository } = buildService(rows);
      repository.findOne.mockResolvedValue(rows[2]);

      const listed = await service.list(scope, null);

      expect(listed.map((item) => item.id)).toEqual([
        'r-default',
        'r-face',
        'r-meta',
        'r-custom',
      ]);
    });

    it('keeps listing when a channel name is already taken', async () => {
      // The operator owns the name; the channel screen simply is not offered.
      // Failing the whole list over it would take Analytics down.
      const { service, repository } = buildService([]);
      repository.findOne.mockResolvedValue(null);

      const violation = new QueryFailedError('', [], new Error('duplicate'));
      (violation as QueryFailedError & { code?: string }).code = '23505';
      repository.save.mockRejectedValue(violation);

      await expect(service.list(scope, null)).resolves.toEqual([]);
    });
  });

  describe('channel screens are fixed', () => {
    it('refuses to rename one', async () => {
      // The name is how the operator finds the channel in the strip, and the
      // seeder would not replace it because the channel is still taken.
      const channelScreen = dashboard({
        name: 'Instagram',
        channelKey: 'instagram',
        channels: ['instagram'],
      });
      const { service } = buildService([channelScreen]);

      await expect(
        service.update(scope, channelScreen.id, { name: 'Outro nome' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to move one to another channel', async () => {
      const channelScreen = dashboard({
        name: 'Instagram',
        channelKey: 'instagram',
        channels: ['instagram'],
      });
      const { service } = buildService([channelScreen]);

      await expect(
        service.update(scope, channelScreen.id, { channels: ['facebook'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to delete one', async () => {
      // The next read would seed it straight back, so the delete would look
      // like a failure rather than a refusal.
      const channelScreen = dashboard({
        name: 'Instagram',
        channelKey: 'instagram',
        channels: ['instagram'],
      });
      const { service, repository } = buildService([channelScreen]);

      await expect(
        service.remove(scope, channelScreen.id),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.remove).not.toHaveBeenCalled();
    });

    it('still accepts a layout edit', async () => {
      // Fixed identity, fully editable contents — the whole point of the
      // change. Renaming to the same string is also allowed, so a client that
      // echoes the current name back is not rejected.
      const channelScreen = dashboard({
        name: 'Instagram',
        channelKey: 'instagram',
        channels: ['instagram'],
      });
      const { service } = buildService([channelScreen]);

      const updated = await service.update(scope, channelScreen.id, {
        name: 'Instagram',
        layout: {
          version: DASHBOARD_LAYOUT_VERSION,
          sections: [
            {
              id: 'section-instagram',
              channel: 'instagram',
              title: 'Instagram',
              cards: [{ id: 'c', kind: 'kpi', size: { w: 3, h: 1 } }],
            },
          ],
        },
      } as never);

      expect(updated.layout.sections[0].cards).toHaveLength(1);
      expect(updated.channelKey).toBe('instagram');
    });
  });
});
