import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable, Writable } from 'node:stream';

import { AssetAccessService } from './asset-access.service';
import { AssetsController } from './assets.controller';
import type { FilesService } from './files.service';

/**
 * End of the asset security matrix (CCOM0.5 §35): the route itself.
 *
 * Proves that a private Team Chat attachment is no longer anonymously readable,
 * and that the legitimate public assets audited in §23 still stream unchanged.
 */

const TEAM_CHAT_PATH_PARTS = [
  'tenants',
  'tenant-a',
  'workspaces',
  'workspace-a',
  'team-chat',
  'messages',
  'message-1',
  'attachments',
  'file.png',
];
const TEAM_CHAT_PATH = TEAM_CHAT_PATH_PARTS.join('/');

function makeHarness() {
  const assetAccess = new AssetAccessService({
    get: () => 'test-access-secret',
  } as unknown as ConfigService);

  const filesService = {
    getAsset: jest.fn().mockResolvedValue({
      body: Readable.from(['bytes']),
      contentType: 'image/png',
      cacheControl: 'public, max-age=31536000, immutable',
    }),
  } as unknown as FilesService;

  const controller = new AssetsController(filesService, assetAccess);

  const headers: Record<string, string> = {};
  // A real writable stream: the controller pipes the object into it.
  const response = Object.assign(
    new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
    {
      setHeader: jest.fn((key: string, value: string) => {
        headers[key] = value;
      }),
    },
  );

  return { controller, filesService, assetAccess, response, headers };
}

describe('AssetsController', () => {
  it('refuses a private Team Chat asset with no grant', async () => {
    const { controller, filesService, response } = makeHarness();

    await expect(
      controller.getAsset(TEAM_CHAT_PATH_PARTS, {}, response as never),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Nothing is fetched from storage on a denial.
    expect(filesService.getAsset).not.toHaveBeenCalled();
  });

  it('serves a private Team Chat asset with a valid grant', async () => {
    const { controller, filesService, assetAccess, response, headers } =
      makeHarness();
    const { query } = assetAccess.issueGrant(TEAM_CHAT_PATH, 'user-a');
    const params = Object.fromEntries(new URLSearchParams(query));

    await controller.getAsset(TEAM_CHAT_PATH_PARTS, params, response as never);

    expect(filesService.getAsset).toHaveBeenCalledWith(TEAM_CHAT_PATH);
    // A per-viewer grant must not land in a shared cache.
    expect(headers['Cache-Control']).toBe('private, max-age=60, no-store');
  });

  it('refuses a grant issued for another object', async () => {
    const { controller, assetAccess, response } = makeHarness();
    const { query } = assetAccess.issueGrant(
      'tenants/tenant-a/workspaces/workspace-a/team-chat/messages/other/attachments/x.png',
      'user-a',
    );
    const params = Object.fromEntries(new URLSearchParams(query));

    await expect(
      controller.getAsset(TEAM_CHAT_PATH_PARTS, params, response as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still serves public assets anonymously', async () => {
    const { controller, filesService, response, headers } = makeHarness();
    const logoParts = [
      'agency',
      'tenants',
      'tenant-a',
      'workspaces',
      'workspace-a',
      'logo-1.webp',
    ];

    await controller.getAsset(logoParts, {}, response as never);

    expect(filesService.getAsset).toHaveBeenCalledWith(logoParts.join('/'));
    // Unchanged caching for public assets: §23 forbids breaking them.
    expect(headers['Cache-Control']).toBe(
      'public, max-age=31536000, immutable',
    );
  });
});
