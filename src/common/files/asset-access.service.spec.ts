import { ConfigService } from '@nestjs/config';

import { AssetAccessService } from './asset-access.service';

/**
 * Asset security matrix (CCOM0.5 §35, §36).
 *
 * `GET /api/assets/*path` had no guard: the storage path WAS the capability, so
 * a Team Chat attachment was readable with no session by anyone holding the URL.
 * These tests pin the classification (which prefixes are private) and the grant
 * (what a valid one proves, and everything it must refuse).
 */

const TEAM_CHAT_PATH =
  'tenants/tenant-a/workspaces/workspace-a/team-chat/messages/message-1/attachments/1700000000-abc.png';
const OTHER_WORKSPACE_PATH =
  'tenants/tenant-a/workspaces/workspace-z/team-chat/messages/message-9/attachments/1700000000-xyz.png';

function makeService(config: Record<string, string | undefined> = {}) {
  const configService = {
    get: (key: string) => (key in config ? config[key] : 'test-access-secret'),
  } as unknown as ConfigService;

  return new AssetAccessService(configService);
}

describe('AssetAccessService classification', () => {
  it.each([
    [TEAM_CHAT_PATH, 'team-chat'],
    ['tenants/t/workspaces/w/tasks/task-1/attachments/file.pdf', 'projects'],
    [
      'tenants/t/workspaces/w/projects/project-1/attachments/file.pdf',
      'projects',
    ],
    ['tenants/t/workspaces/w/inbox/attachments/audio.m4a', 'inbox'],
  ])('treats %s as private (%s)', (path, kind) => {
    expect(makeService().classifyPrivatePath(path)).toBe(kind);
  });

  it.each([
    // Public by design: rendered in <img> by surfaces that send no credentials.
    'agency/tenants/t/users/u/avatar-1.webp',
    'agency/tenants/t/workspaces/w/logo-1.webp',
    'agency/tenants/t/workspaces/w/team/members/m/avatar-1.webp',
    'tenants/t/webchat/widgets/widget-1/avatar-1.webp',
    'tenants/t/workspaces/w/knowledge/article-1/cover-1.webp',
  ])('leaves %s public', (path) => {
    expect(makeService().classifyPrivatePath(path)).toBeNull();
  });
});

describe('AssetAccessService grants', () => {
  it('lets a grant holder fetch the attachment it was issued for', () => {
    const service = makeService();
    const { query } = service.issueGrant(TEAM_CHAT_PATH, 'user-a');
    const params = Object.fromEntries(new URLSearchParams(query));

    expect(service.verifyGrant(TEAM_CHAT_PATH, params)).toEqual({
      ok: true,
      userId: 'user-a',
    });
  });

  it('denies a request with no grant at all', () => {
    const service = makeService();

    expect(service.verifyGrant(TEAM_CHAT_PATH, {})).toEqual({
      ok: false,
      reason: 'missing_grant',
    });
  });

  it('denies a grant minted for a different path', () => {
    const service = makeService();
    const { query } = service.issueGrant(TEAM_CHAT_PATH, 'user-a');
    const params = Object.fromEntries(new URLSearchParams(query));

    // §35: a member of one channel cannot move their grant to another object,
    // including an attachment of another workspace.
    expect(service.verifyGrant(OTHER_WORKSPACE_PATH, params)).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
  });

  it('denies a tampered user id', () => {
    const service = makeService();
    const { query } = service.issueGrant(TEAM_CHAT_PATH, 'user-a');
    const params = Object.fromEntries(new URLSearchParams(query));

    expect(
      service.verifyGrant(TEAM_CHAT_PATH, { ...params, au: 'user-b' }),
    ).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('denies a tampered expiry', () => {
    const service = makeService();
    const { query } = service.issueGrant(TEAM_CHAT_PATH, 'user-a');
    const params = Object.fromEntries(new URLSearchParams(query));

    expect(
      service.verifyGrant(TEAM_CHAT_PATH, {
        ...params,
        ae: String(Math.floor(Date.now() / 1000) + 86400),
      }),
    ).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('denies an expired grant', () => {
    const service = makeService();
    const { query } = service.issueGrant(TEAM_CHAT_PATH, 'user-a', -10);
    const params = Object.fromEntries(new URLSearchParams(query));

    expect(service.verifyGrant(TEAM_CHAT_PATH, params)).toEqual({
      ok: false,
      reason: 'expired_grant',
    });
  });

  it('denies a forged signature', () => {
    const service = makeService();

    expect(
      service.verifyGrant(TEAM_CHAT_PATH, {
        au: 'user-a',
        ae: String(Math.floor(Date.now() / 1000) + 600),
        as: 'not-a-real-signature',
      }),
    ).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('denies a malformed expiry', () => {
    const service = makeService();

    expect(
      service.verifyGrant(TEAM_CHAT_PATH, {
        au: 'user-a',
        ae: 'soon',
        as: 'x',
      }),
    ).toEqual({ ok: false, reason: 'malformed_grant' });
  });

  it('denies everything when no signing key is configured', () => {
    const service = makeService({
      ASSET_GRANT_SECRET: undefined,
      JWT_ACCESS_SECRET: undefined,
    });
    const { query } = service.issueGrant(TEAM_CHAT_PATH, 'user-a');
    const params = Object.fromEntries(new URLSearchParams(query));

    // Fail closed: without a key nothing can be signed, so nothing verifies.
    expect(service.verifyGrant(TEAM_CHAT_PATH, params).ok).toBe(false);
  });

  it('is not satisfied by a grant signed with another key', () => {
    const issuer = makeService({ ASSET_GRANT_SECRET: 'key-one' });
    const verifier = makeService({ ASSET_GRANT_SECRET: 'key-two' });
    const { query } = issuer.issueGrant(TEAM_CHAT_PATH, 'user-a');
    const params = Object.fromEntries(new URLSearchParams(query));

    expect(verifier.verifyGrant(TEAM_CHAT_PATH, params)).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
  });
});

describe('AssetAccessService path traversal', () => {
  it.each([
    'tenants/t/workspaces/w/team-chat/../../../agency/secret.webp',
    'tenants/t/workspaces/w/team-chat/%2e%2e/%2e%2e/secret.webp',
    'tenants/t/workspaces/w/team-chat/%252e%252e/secret.webp',
    'tenants/t/workspaces/w/team-chat/..%2fsecret.webp',
    'tenants/t/workspaces/w/team-chat\\..\\secret.webp',
  ])('keeps %s inside the private classification', (path) => {
    // §36: a traversal attempt against a private prefix must not escape into the
    // public classification and so skip the grant check. `FilesService`
    // independently rejects the path before any object is fetched.
    expect(makeService().isPrivatePath(path)).toBe(true);
  });

  it.each([
    '/tenants/t/workspaces/w/team-chat/messages/m/attachments/a.png',
    'tenants%2Ft%2Fworkspaces%2Fw%2Fteam-chat%2Fmessages%2Fm%2Fattachments%2Fa.png',
  ])('classifies %s as private despite encoding', (path) => {
    expect(makeService().isPrivatePath(path)).toBe(true);
  });

  it('verifies the same object through an encoded path', () => {
    const service = makeService();
    const { query } = service.issueGrant(TEAM_CHAT_PATH, 'user-a');
    const params = Object.fromEntries(new URLSearchParams(query));
    const encoded = TEAM_CHAT_PATH.split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');

    // The signature covers the decoded path, so the URL encoding the proxy
    // produces still verifies — without letting `..` through.
    expect(service.verifyGrant(encoded, params)).toEqual({
      ok: true,
      userId: 'user-a',
    });
  });
});

describe('AssetAccessService authorizeUrl', () => {
  it('appends a grant to a private url', () => {
    const service = makeService();
    const url = service.authorizeUrl(
      `/api/assets/${TEAM_CHAT_PATH}`,
      TEAM_CHAT_PATH,
      'user-a',
    );

    expect(url).toContain('au=user-a');
    expect(url).toContain('as=');
  });

  it('leaves a public url untouched', () => {
    const service = makeService();
    const publicPath = 'agency/tenants/t/workspaces/w/logo-1.webp';
    const url = service.authorizeUrl(
      `/api/assets/${publicPath}`,
      publicPath,
      'user-a',
    );

    expect(url).toBe(`/api/assets/${publicPath}`);
  });

  it('leaves the url untouched when there is no viewer', () => {
    const service = makeService();
    const url = `/api/assets/${TEAM_CHAT_PATH}`;

    expect(service.authorizeUrl(url, TEAM_CHAT_PATH, null)).toBe(url);
  });
});
