import { ConfigService } from '@nestjs/config';

import { AssetAccessService } from '../../../common/files/asset-access.service';
import {
  authorizeAttachmentUrl,
  authorizeMessageMetadata,
} from './team-chat-attachment-urls';

/**
 * The read-time re-signing of attachment URLs (CCOM0.5 §25–§28), end to end:
 * a stored URL goes in, a grant comes out, and that grant verifies against the
 * same object on the asset route.
 */

const STORAGE_PATH =
  'tenants/tenant-a/workspaces/workspace-a/team-chat/messages/message-1/attachments/file.png';
const STORED_URL = `/api/assets/${STORAGE_PATH}`;

function makeAssetAccess() {
  return new AssetAccessService({
    get: () => 'test-access-secret',
  } as unknown as ConfigService);
}

describe('authorizeAttachmentUrl', () => {
  it('produces a grant the asset route accepts for the same object', () => {
    const assetAccess = makeAssetAccess();

    const authorized = authorizeAttachmentUrl(
      assetAccess,
      STORED_URL,
      'user-a',
    );

    const [path, query] = (authorized as string).split('?');
    expect(path).toBe(STORED_URL);

    const params = Object.fromEntries(new URLSearchParams(query));
    expect(assetAccess.verifyGrant(STORAGE_PATH, params)).toEqual({
      ok: true,
      userId: 'user-a',
    });
  });

  it('does not stack grants when a url is re-read', () => {
    const assetAccess = makeAssetAccess();

    const once = authorizeAttachmentUrl(assetAccess, STORED_URL, 'user-a');
    const twice = authorizeAttachmentUrl(assetAccess, once, 'user-a');

    expect((twice as string).match(/\?/g)).toHaveLength(1);
    expect((twice as string).match(/au=/g)).toHaveLength(1);
  });

  it('binds the grant to the reader, so two viewers get different grants', () => {
    const assetAccess = makeAssetAccess();

    const forA = authorizeAttachmentUrl(assetAccess, STORED_URL, 'user-a');
    const forB = authorizeAttachmentUrl(assetAccess, STORED_URL, 'user-b');

    expect(forA).not.toEqual(forB);

    // B's grant does not verify as A, so a copied link is not transferable.
    const paramsB = Object.fromEntries(
      new URLSearchParams((forB as string).split('?')[1]),
    );
    expect(assetAccess.verifyGrant(STORAGE_PATH, paramsB)).toEqual({
      ok: true,
      userId: 'user-b',
    });
  });

  it('leaves a public asset url untouched', () => {
    const assetAccess = makeAssetAccess();
    const logo = '/api/assets/agency/tenants/t/workspaces/w/logo-1.webp';

    expect(authorizeAttachmentUrl(assetAccess, logo, 'user-a')).toBe(logo);
  });

  it('passes through a null url and a missing viewer', () => {
    const assetAccess = makeAssetAccess();

    expect(authorizeAttachmentUrl(assetAccess, null, 'user-a')).toBeNull();
    expect(authorizeAttachmentUrl(assetAccess, STORED_URL, null)).toBe(
      STORED_URL,
    );
  });

  it('leaves a url that is not an asset proxy url alone', () => {
    const assetAccess = makeAssetAccess();
    const external = 'https://cdn.example.com/image.png';

    expect(authorizeAttachmentUrl(assetAccess, external, 'user-a')).toBe(
      external,
    );
  });
});

describe('authorizeMessageMetadata', () => {
  it('re-signs attachment urls stored in message metadata', () => {
    const assetAccess = makeAssetAccess();

    const result = authorizeMessageMetadata(
      assetAccess,
      {
        attachments: [
          { id: 'a1', name: 'file.png', url: STORED_URL },
          { id: 'a2', name: 'logo.webp', url: '/api/assets/agency/logo.webp' },
        ],
        card: { kind: 'approval_card' },
      },
      'user-a',
    );

    const attachments = result?.attachments as Record<string, unknown>[];

    expect(attachments[0].url).toContain('au=user-a');
    // Public one untouched, and unrelated metadata survives verbatim.
    expect(attachments[1].url).toBe('/api/assets/agency/logo.webp');
    expect(result?.card).toEqual({ kind: 'approval_card' });
  });

  it('returns metadata unchanged when there are no attachments', () => {
    const assetAccess = makeAssetAccess();
    const metadata = { card: { kind: 'approval_card' } };

    expect(authorizeMessageMetadata(assetAccess, metadata, 'user-a')).toBe(
      metadata,
    );
  });

  it('tolerates malformed attachment entries', () => {
    const assetAccess = makeAssetAccess();

    const result = authorizeMessageMetadata(
      assetAccess,
      { attachments: [null, 'string', { id: 'a1' }, { url: 42 }] },
      'user-a',
    );

    expect(result?.attachments).toEqual([
      null,
      'string',
      { id: 'a1' },
      { url: 42 },
    ]);
  });

  it('passes through null metadata and a missing viewer', () => {
    const assetAccess = makeAssetAccess();

    expect(authorizeMessageMetadata(assetAccess, null, 'user-a')).toBeNull();

    const metadata = { attachments: [{ url: STORED_URL }] };
    expect(authorizeMessageMetadata(assetAccess, metadata, null)).toBe(
      metadata,
    );
  });
});
