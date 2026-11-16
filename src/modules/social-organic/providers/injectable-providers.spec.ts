import { Test } from '@nestjs/testing';
import { LinkedInCallBudget } from './linkedin/linkedin-call-budget';
import { YoutubeUploadQuota } from './youtube/youtube-upload-quota';

/**
 * Boot regression (2026-11-16): a constructor default such as
 * `constructor(private readonly limit = 100)` makes Nest look for a provider
 * for `limit` and the API fails to start. The module spec only reads
 * metadata, so the real injector is exercised here.
 */
describe('counters resolve through the Nest injector', () => {
  it.each([YoutubeUploadQuota, LinkedInCallBudget])('%p', async (provider) => {
    const moduleRef = await Test.createTestingModule({
      providers: [provider],
    }).compile();
    expect(moduleRef.get(provider)).toBeInstanceOf(provider);
  });
});
