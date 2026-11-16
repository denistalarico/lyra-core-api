import { YoutubeApiError } from '../providers/youtube/youtube-api.client';
import { classifyOrganicSyncFailure } from './social-organic-sync-retry';

describe('classifyOrganicSyncFailure (YouTube)', () => {
  it.each([
    [new YoutubeApiError(403, 'quotaExceeded'), true, true],
    [new YoutubeApiError(503, null), true, false],
    [new YoutubeApiError(401, null), false, false],
    [new YoutubeApiError(400, 'badRequest'), false, false],
  ])('%p → retry %s, rateLimited %s', (error, retry, rateLimited) => {
    expect(classifyOrganicSyncFailure(error)).toMatchObject({
      retry,
      rateLimited,
    });
  });
});
