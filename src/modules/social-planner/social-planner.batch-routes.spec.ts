import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../permissions';
import { SocialPlannerController } from './social-planner.controller';

/**
 * D-CA10-BE-3 — Express matches routes in declaration order, so a
 * `content/batch/<action>` route declared after `content/:contentId/<action>`
 * was handed to the per-item handler (`batch` failed ParseUUIDPipe: 400).
 */
describe('Social Planner batch routes reach the batch handlers', () => {
  let app: INestApplication;
  const lifecycle = {
    archiveMany: jest
      .fn()
      .mockResolvedValue({ items: [], succeeded: 0, failed: 0 }),
    restoreMany: jest
      .fn()
      .mockResolvedValue({ items: [], succeeded: 0, failed: 0 }),
    removeMany: jest
      .fn()
      .mockResolvedValue({ items: [], succeeded: 0, failed: 0 }),
    archive: jest.fn().mockResolvedValue({}),
    restore: jest.fn().mockResolvedValue({}),
  };
  const copy = {
    requestForSelection: jest
      .fn()
      .mockResolvedValue({ items: [], succeeded: 0, failed: 0 }),
    requestForContent: jest.fn().mockResolvedValue({}),
  };

  beforeAll(async () => {
    const tokens = (
      Reflect.getMetadata(
        'design:paramtypes',
        SocialPlannerController,
      ) as unknown[]
    ).map((provide) => ({ provide: provide as string, useValue: {} }));
    // Constructor order: planner, lifecycle (1), settings, cadence, campaign, copy generation (5), …
    const ref = await Test.createTestingModule({
      controllers: [SocialPlannerController],
      providers: tokens,
    })
      .overrideProvider(tokens[1].provide)
      .useValue(lifecycle)
      .overrideProvider(tokens[5].provide)
      .useValue(copy)
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest<{ user: object }>().user = {
            tenantId: randomUUID(),
            workspaceId: randomUUID(),
            sub: randomUUID(),
            role: 'owner',
          };
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = ref.createNestApplication({ logger: false });
    await app.init();
  });
  afterAll(() => app?.close());

  const post = (path: string, body: object) =>
    request(app.getHttpServer() as Server)
      .post(`/social/planner/${path}`)
      .send(body);

  it.each([
    ['content/batch/archive', 'archiveMany'],
    ['content/batch/restore', 'restoreMany'],
    ['content/batch/delete', 'removeMany'],
  ] as const)('POST %s → lifecycle.%s', async (path, method) => {
    const contentIds = [randomUUID()];
    const response = await post(path, { contentIds });
    expect(response.status).toBe(201);
    expect(lifecycle[method]).toHaveBeenCalledWith(
      expect.anything(),
      contentIds,
      expect.anything(),
    );
  });

  it('POST content/batch/copy-generation → requestForSelection', async () => {
    const response = await post('content/batch/copy-generation', {
      contentIds: [randomUUID()],
    });
    expect(response.status).toBe(201);
    expect(copy.requestForSelection).toHaveBeenCalled();
  });

  it('the per-item routes still reach the per-item handlers', async () => {
    const id = randomUUID();
    expect((await post(`content/${id}/archive`, {})).status).toBe(201);
    expect(lifecycle.archive).toHaveBeenCalledWith(
      expect.anything(),
      id,
      expect.anything(),
    );
    expect((await post(`content/${id}/restore`, {})).status).toBe(201);
    expect(lifecycle.restore).toHaveBeenCalledWith(
      expect.anything(),
      id,
      expect.anything(),
    );
  });
});
