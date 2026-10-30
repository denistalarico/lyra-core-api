import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
jest.mock('../services/client-area-profile.service', () => ({
  ClientAreaProfileService: class ClientAreaProfileService {},
}));
import { ClientAreaProfileController } from './client-area-profile.controller';
import { ClientAreaProfileService } from '../services/client-area-profile.service';
import {
  ClientAreaAuthGuard,
  ClientAreaEnabledGuard,
} from '../guards/client-area.guards';

describe('ClientAreaProfileController HTTP facade', () => {
  const profile = {
    displayName: 'Ana Cliente',
    jobTitle: 'Diretora',
    phone: '+5511999999999',
    email: 'ana@example.test',
    avatarUrl: null,
  };

  async function createApp() {
    const profiles = {
      get: jest.fn().mockResolvedValue(profile),
      patch: jest.fn().mockResolvedValue(profile),
      uploadAvatar: jest.fn().mockResolvedValue(profile),
      removeAvatar: jest.fn().mockResolvedValue(profile),
      readAvatar: jest.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [ClientAreaProfileController],
      providers: [
        { provide: ClientAreaProfileService, useValue: profiles },
      ],
    })
      .overrideGuard(ClientAreaEnabledGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ClientAreaAuthGuard)
      .useValue({
        canActivate: (context: { switchToHttp(): { getRequest(): Record<string, unknown> } }) => {
          context.switchToHttp().getRequest().clientAreaIdentity = {
            tenantId: '10000000-0000-4000-8000-000000000001',
            userId: '10000000-0000-4000-8000-000000000002',
            email: profile.email,
          };
          return true;
        },
      })
      .compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    return { app, profiles };
  }

  it('returns 400 with the stable profile code for invalid user input', async () => {
    const { app } = await createApp();
    await request(app.getHttpServer())
      .patch('/client-area/me/profile')
      .send({ phone: '11 99999-9999' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('client_area_invalid_profile');
      });
    await app.close();
  });

  it('updates only the current identity profile and keeps email read-only', async () => {
    const { app, profiles } = await createApp();
    await request(app.getHttpServer())
      .patch('/client-area/me/profile')
      .send({ displayName: 'Ana Nova', jobTitle: 'CEO', phone: '+5511988887777' })
      .expect(200);
    expect(profiles.patch).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '10000000-0000-4000-8000-000000000001',
        userId: '10000000-0000-4000-8000-000000000002',
      }),
      { displayName: 'Ana Nova', jobTitle: 'CEO', phone: '+5511988887777' },
    );
    await app.close();
  });

  it('returns the stable 400 code when an avatar exceeds 2 MB', async () => {
    const { app } = await createApp();
    await request(app.getHttpServer())
      .post('/client-area/me/profile/avatar')
      .attach('file', Buffer.alloc(2 * 1024 * 1024 + 1), {
        filename: 'avatar.png',
        contentType: 'image/png',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('client_area_invalid_profile');
      });
    await app.close();
  });
});
