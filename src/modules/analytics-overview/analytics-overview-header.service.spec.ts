import { BadRequestException } from '@nestjs/common';
import { IsNull, QueryFailedError } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import type { AnalyticsOverviewHeaderEntity } from './analytics-overview-header.entity';
import {
  AnalyticsOverviewHeaderService,
  DEFAULT_OVERVIEW_TITLE,
} from './analytics-overview-header.service';

const companyScope: CompanyAwareScope = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  agencyClientId: '30000000-0000-4000-8000-000000000001',
  companyContextId: '31000000-0000-4000-8000-000000000001',
};
const rootScope: CompanyAwareScope = {
  ...companyScope,
  agencyClientId: null,
  companyContextId: null,
};
const ACTOR = '50000000-0000-4000-8000-000000000001';

function header(
  overrides: Partial<AnalyticsOverviewHeaderEntity> = {},
): AnalyticsOverviewHeaderEntity {
  return {
    id: '40000000-0000-4000-8000-000000000001',
    ...companyScope,
    title: 'Visão Geral',
    description: 'Principais métricas de todos os canais',
    updatedById: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  } as AnalyticsOverviewHeaderEntity;
}

function buildService(row: AnalyticsOverviewHeaderEntity | null = null) {
  const repository = {
    findOne: jest.fn().mockResolvedValue(row),
    create: jest.fn((input: unknown) => ({ ...(input as object) })),
    save: jest.fn((entity: AnalyticsOverviewHeaderEntity) =>
      Promise.resolve({
        ...entity,
        updatedAt: new Date('2026-10-26T00:00:00.000Z'),
      }),
    ),
  };
  return {
    service: new AnalyticsOverviewHeaderService(repository as never),
    repository,
  };
}

describe('AnalyticsOverviewHeaderService', () => {
  describe('get', () => {
    it('falls back to "Visão Geral" without a description and writes nothing', async () => {
      const { service, repository } = buildService(null);

      await expect(service.get(companyScope)).resolves.toEqual({
        title: DEFAULT_OVERVIEW_TITLE,
        description: null,
        updatedAt: null,
      });
      expect(repository.save).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('returns the stored header of the scope', async () => {
      const { service } = buildService(header());

      await expect(service.get(companyScope)).resolves.toEqual({
        title: 'Visão Geral',
        description: 'Principais métricas de todos os canais',
        updatedAt: '2026-10-01T00:00:00.000Z',
      });
    });

    it('looks the company scope up by its full quartet', async () => {
      const { service, repository } = buildService(null);
      await service.get(companyScope);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: {
          tenantId: companyScope.tenantId,
          workspaceId: companyScope.workspaceId,
          agencyClientId: companyScope.agencyClientId,
          companyContextId: companyScope.companyContextId,
        },
      });
    });

    it('looks the agency root up with IS NULL, never matching a company row', async () => {
      const { service, repository } = buildService(null);
      await service.get(rootScope);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: {
          tenantId: rootScope.tenantId,
          workspaceId: rootScope.workspaceId,
          agencyClientId: IsNull(),
          companyContextId: IsNull(),
        },
      });
    });
  });

  describe('update', () => {
    it('creates the row on first save, in the caller scope, with the actor', async () => {
      const { service, repository } = buildService(null);

      const view = await service.update(rootScope, ACTOR, {
        description: 'Resumo do mês',
      });

      expect(repository.create).toHaveBeenCalledWith({
        tenantId: rootScope.tenantId,
        workspaceId: rootScope.workspaceId,
        agencyClientId: null,
        companyContextId: null,
        title: DEFAULT_OVERVIEW_TITLE,
        description: null,
      });
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: DEFAULT_OVERVIEW_TITLE,
          description: 'Resumo do mês',
          updatedById: ACTOR,
        }),
      );
      expect(view).toEqual({
        title: DEFAULT_OVERVIEW_TITLE,
        description: 'Resumo do mês',
        updatedAt: '2026-10-26T00:00:00.000Z',
      });
    });

    it('updates the existing row field by field', async () => {
      const { service, repository } = buildService(header());

      await service.update(companyScope, ACTOR, { title: '  Painel  ' });

      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '40000000-0000-4000-8000-000000000001',
          title: 'Painel',
          // Untouched: the DTO did not carry it.
          description: 'Principais métricas de todos os canais',
          updatedById: ACTOR,
        }),
      );
    });

    it('stores an empty or blank description as null', async () => {
      const { service, repository } = buildService(header());

      await service.update(companyScope, ACTOR, { description: '   ' });
      expect(repository.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ description: null }),
      );

      await service.update(companyScope, ACTOR, { description: null });
      expect(repository.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ description: null }),
      );
    });

    it.each([
      ['empty title', { title: '' }],
      ['blank title', { title: '   ' }],
      ['title over 120 after trim', { title: 'a'.repeat(121) }],
      ['description over 500 after trim', { description: 'b'.repeat(501) }],
    ])('rejects %s', async (_label, dto) => {
      const { service, repository } = buildService(header());

      await expect(
        service.update(companyScope, ACTOR, dto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('accepts limits measured after trimming', async () => {
      const { service, repository } = buildService(header());

      await service.update(companyScope, ACTOR, {
        title: `  ${'a'.repeat(120)}  `,
        description: ` ${'b'.repeat(500)} `,
      });
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'a'.repeat(120),
          description: 'b'.repeat(500),
        }),
      );
    });

    it('re-reads and applies on top after losing the first-save race', async () => {
      const { service, repository } = buildService(null);
      const conflict = Object.assign(
        new QueryFailedError('INSERT', [], new Error('duplicate key')),
        { code: '23505' },
      );
      repository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(header({ title: 'Do vencedor' }));
      repository.save.mockRejectedValueOnce(conflict);

      const view = await service.update(companyScope, ACTOR, {
        description: 'Do perdedor',
      });

      expect(view).toMatchObject({
        title: 'Do vencedor',
        description: 'Do perdedor',
      });
      expect(repository.save).toHaveBeenCalledTimes(2);
    });
  });
});
