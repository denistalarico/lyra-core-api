import { AssetAccessService } from '../../common/files/asset-access.service';
import { authorizeInboxMessage } from './inbox-attachment-urls';

describe('Inbox attachment grants', () => {
  const access = new AssetAccessService({
    get: () => 'offline-test-secret',
  } as never);
  const path = 'tenants/t/workspaces/w/inbox/attachments/image.jpg';
  const url = `/api/assets/${path}`;

  it('signs all outbound URL locations for the viewer without mutating persisted JSON', () => {
    const message = {
      tenantId: 't',
      workspaceId: 'w',
      metadata: { mediaUrl: url, attachmentUrl: url, other: 'preserved' },
      attachments: [{ url, name: 'image.jpg' }],
    };
    const result = authorizeInboxMessage(access, message, 'viewer');
    for (const signed of [
      result.metadata.mediaUrl,
      result.metadata.attachmentUrl,
      result.attachments[0].url,
    ]) {
      const parsed = new URL(signed, 'https://api.example.com');
      expect(
        access.verifyGrant(path, Object.fromEntries(parsed.searchParams)),
      ).toEqual({ ok: true, userId: 'viewer' });
      expect(
        access.verifyGrant(
          `${path}.other`,
          Object.fromEntries(parsed.searchParams),
        ).ok,
      ).toBe(false);
    }
    expect(message.metadata.mediaUrl).toBe(url);
    expect(message.attachments[0].url).toBe(url);
    expect(result.metadata.other).toBe('preserved');
  });

  it('renews old grants and keeps public and inbound canonical URLs intact', () => {
    const result = authorizeInboxMessage(
      access,
      {
        tenantId: 't',
        workspaceId: 'w',
        metadata: {
          mediaUrl: `${url}?au=old&ae=1&as=old`,
          attachmentUrl: '/inbox/media/id/content',
        },
        attachments: [{ url: '/api/assets/public/logo.png' }],
      },
      'new-viewer',
    );
    expect(result.metadata.mediaUrl).not.toContain('au=old');
    expect(result.metadata.attachmentUrl).toBe('/inbox/media/id/content');
    expect(result.attachments[0].url).toBe('/api/assets/public/logo.png');
  });

  it('supports the provider subject and one hour TTL without changing verifyGrant', () => {
    const before = Math.floor(Date.now() / 1000);
    const grant = access.issueGrant(path, 'provider:meta', 3600);
    const params = Object.fromEntries(new URLSearchParams(grant.query));
    expect(access.verifyGrant(path, params)).toEqual({
      ok: true,
      userId: 'provider:meta',
    });
    expect(Number(params.ae) - before).toBeGreaterThanOrEqual(3600);
    expect(Number(params.ae) - before).toBeLessThanOrEqual(3601);
  });

  it('does not mint a grant for another workspace, private module or external origin', () => {
    for (const candidate of [
      '/api/assets/tenants/other/workspaces/w/inbox/attachments/secret.jpg',
      '/api/assets/tenants/t/workspaces/other/inbox/attachments/secret.jpg',
      '/api/assets/tenants/t/workspaces/w/team-chat/attachments/secret.jpg',
      `https://external.example.com${url}`,
    ]) {
      const result = authorizeInboxMessage(
        access,
        {
          tenantId: 't',
          workspaceId: 'w',
          metadata: { mediaUrl: candidate },
          attachments: [],
        },
        'viewer',
      );
      expect(result.metadata.mediaUrl).toBe(candidate);
    }
  });
});
