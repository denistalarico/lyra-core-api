import { BadRequestException, ConflictException } from '@nestjs/common';
import { SocialOrganicCredentialError } from '../credentials';
import { SocialOrganicYoutubeService } from './social-organic-youtube.service';

const SCOPE = {
  tenantId: 't1',
  workspaceId: 'w1',
  agencyClientId: null,
  companyContextId: null,
};

function build(channelIds: string[]) {
  const credentials = {
    resolveGoogleDiscoveryToken: jest.fn().mockResolvedValue('tok'),
  };
  const google = {
    listYoutubeChannels: jest.fn().mockResolvedValue(
      channelIds.map((channelId) => ({
        channelId,
        title: 'Canal',
        customUrl: null,
        thumbnailUrl: null,
      })),
    ),
  };
  const getMany = jest.fn().mockResolvedValue([]);
  const qb: Record<string, jest.Mock> = { getMany };
  for (const m of ['where', 'andWhere']) qb[m] = jest.fn(() => qb);
  const transaction = jest.fn();
  const dataSource = {
    transaction,
    getRepository: () => ({ createQueryBuilder: () => qb }),
  };
  const service = new SocialOrganicYoutubeService(
    dataSource as never,
    credentials as never,
    google as never,
  );
  return { service, credentials, google, transaction, qb, getMany };
}

describe('SocialOrganicYoutubeService', () => {
  it('rejects a channel id that is not in the live listing (400)', async () => {
    const { service, transaction } = build(['UCaaa']);
    await expect(
      service.select({ ...SCOPE, userId: null, channelId: 'UCother' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('lists channels under the discovery token of the same scope', async () => {
    const { service, credentials, google } = build(['UCaaa']);
    const out = await service.listChannels(SCOPE);
    expect(credentials.resolveGoogleDiscoveryToken).toHaveBeenCalledWith(
      SCOPE,
      'youtube',
    );
    expect(google.listYoutubeChannels).toHaveBeenCalledWith('tok');
    expect(out.channels[0]).toMatchObject({
      channelId: 'UCaaa',
      selected: false,
    });
  });

  it('reads the selection only inside the caller context (A never reads B)', async () => {
    const { service, qb, getMany } = build(['UCaaa']);
    getMany.mockResolvedValue([{ externalAssetId: 'UCaaa' }]);
    const out = await service.listChannels({
      ...SCOPE,
      companyContextId: 'ctxA',
    });
    expect(out.channels[0].selected).toBe(true);
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('companyContextId IS NOT DISTINCT FROM'),
      { companyContextId: 'ctxA' },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('agencyClientId IS NOT DISTINCT FROM'),
      { agencyClientId: null },
    );
  });

  it('maps product not connected to 404 and expired credential to 409', async () => {
    const { service, credentials } = build([]);
    credentials.resolveGoogleDiscoveryToken.mockRejectedValueOnce(
      new SocialOrganicCredentialError('connection_not_connected'),
    );
    await expect(service.listChannels(SCOPE)).rejects.toMatchObject({
      status: 404,
    });
    credentials.resolveGoogleDiscoveryToken.mockRejectedValueOnce(
      new SocialOrganicCredentialError('credential_expired'),
    );
    await expect(service.listChannels(SCOPE)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
