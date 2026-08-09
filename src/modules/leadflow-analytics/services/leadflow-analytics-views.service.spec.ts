import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LeadFlowAnalyticsViewsService } from './leadflow-analytics-views.service';

const ctx = {
  tenantId: '2bc8a189-a03c-4020-97a1-8f68ce10bdf3',
  workspaceId: '1e278ed5-53ce-49b9-a8aa-c73ca93149a4',
  userId: 'c143ef9e-3c45-4dde-a245-39f09ca41d78',
};

const view = {
  name: 'Operação semanal',
  reportType: 'overview' as const,
  from: '2026-08-01',
  to: '2026-08-04',
};

function buildService() {
  const query = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn(async () => null),
  };
  const repository = {
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    count: jest.fn(async () => 0),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({ ...value, id: 'view-id' })),
    update: jest.fn(async () => ({ affected: 1 })),
    delete: jest.fn(async () => ({ affected: 1 })),
    createQueryBuilder: jest.fn(() => query),
  };
  return {
    service: new LeadFlowAnalyticsViewsService(repository as never),
    repository,
    query,
  };
}

describe('LeadFlowAnalyticsViewsService', () => {
  it('always scopes a list to the authenticated user and active context', async () => {
    const { service, repository } = buildService();

    await service.list(ctx);

    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          contextType: 'agency',
        }),
        take: 20,
      }),
    );
  });

  it('derives client scope from the server request context', async () => {
    const { service, repository } = buildService();

    await service.list({
      ...ctx,
      managedContext: {
        productKey: 'leadflow',
        operatingMode: 'client',
        clientId: '62d2eb20-8b90-4a2b-9958-5a32b4f7dc90',
        managedTenantId: null,
      },
    });

    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contextType: 'client',
          agencyClientId: '62d2eb20-8b90-4a2b-9958-5a32b4f7dc90',
        }),
      }),
    );
  });

  it('rejects invalid date order before persisting a view', async () => {
    const { service, repository } = buildService();

    await expect(
      service.create(ctx, { ...view, from: '2026-08-05' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('does not reveal or update another user’s view', async () => {
    const { service, repository } = buildService();

    await expect(service.update(ctx, 'view-id', view)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'view-id', userId: ctx.userId }),
      }),
    );
  });

  it('rejects widget ids outside the governed catalog', async () => {
    const { service, repository } = buildService();

    await expect(
      service.create(ctx, { ...view, widgetOrder: ['not-a-widget'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('keeps only one default view in the authenticated scope', async () => {
    const { service, repository } = buildService();

    await service.create(ctx, { ...view, isDefault: true });

    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
      }),
      { isDefault: false },
    );
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ isDefault: true }),
    );
  });

  it('persists governed summary and chart preferences', async () => {
    const { service, repository } = buildService();

    await service.create(ctx, {
      ...view,
      summaryTypes: ['executive', 'commercial'],
      chartModes: {
        commercial_stages: 'vertical_bar',
        commercial_handoff: 'area',
      },
    });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 2,
        summaryTypes: ['executive', 'commercial'],
        chartModes: {
          commercial_stages: 'vertical_bar',
          commercial_handoff: 'area',
        },
      }),
    );
  });

  it('rejects unknown chart preferences', async () => {
    const { service } = buildService();

    await expect(
      service.create(ctx, {
        ...view,
        chartModes: { commercial_stages: 'radar' as never },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
