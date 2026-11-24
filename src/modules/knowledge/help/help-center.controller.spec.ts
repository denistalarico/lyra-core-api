import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import type { Server } from 'node:http';
import request from 'supertest';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ClientAreaAuthGuard } from '../../client-area/guards/client-area.guards';
import {
  ClientAreaHelpCenterController,
  HelpCenterController,
} from './help-center.controller';
import { HelpCenterService } from './help-center.service';

jest.mock('../../client-area/guards/client-area.guards', () => ({
  ClientAreaAuthGuard: class ClientAreaAuthGuard {},
}));

describe('Help Center surfaces', () => {
  let app: INestApplication;
  const listArticles = jest.fn().mockResolvedValue([{ slug: 'planejamento' }]);
  const guard = (session: string) => ({
    canActivate: (context: ExecutionContext) =>
      context.switchToHttp().getRequest<Request>().headers.authorization ===
      `Bearer ${session}`,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HelpCenterController, ClientAreaHelpCenterController],
      providers: [{ provide: HelpCenterService, useValue: { listArticles } }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(guard('agency'))
      .overrideGuard(ClientAreaAuthGuard)
      .useValue(guard('client'))
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    ['/agency/knowledge/help', 'agency', 'client'],
    ['/client-area/help', 'client', 'agency'],
  ])(
    'uses the expected session guard and shared catalog on %s',
    async (base, allowed, denied) => {
      const path = `${base}/articles`;
      const server = app.getHttpServer() as Server;
      await request(server).get(path).expect(403);
      await request(server)
        .get(path)
        .set('Authorization', `Bearer ${denied}`)
        .expect(403);
      await request(server)
        .post(path)
        .set('Authorization', `Bearer ${allowed}`)
        .expect(404);
      await request(server)
        .get(path)
        .query({
          search: 'planejamento',
          locale: 'pt-BR',
          categoryKey: 'social',
        })
        .set('Authorization', `Bearer ${allowed}`)
        .expect(200, [{ slug: 'planejamento' }]);
      expect(listArticles).toHaveBeenLastCalledWith({
        search: 'planejamento',
        locale: 'pt-BR',
        categoryKey: 'social',
      });
    },
  );
});
