import { Injectable } from '@nestjs/common';

/** `videos.insert` has its own quota: 100 calls/day per project (2026-06-01). */
export const YOUTUBE_DAILY_UPLOAD_LIMIT = 100;

/**
 * Per-process daily upload counter (same pattern as the Google Ads budget,
 * D-G11). The quota day resets at midnight Pacific time. A restart or a
 * second API process keeps its own count, so a provider `quotaExceeded` /
 * `uploadLimitExceeded` is still mapped to `rate_limited` by the adapter.
 */
@Injectable()
export class YoutubeUploadQuota {
  private day = '';
  private used = 0;

  constructor(private readonly limit = YOUTUBE_DAILY_UPLOAD_LIMIT) {}

  /** True and counted when an upload may start; false when today is spent. */
  tryConsume(now: Date = new Date()): boolean {
    const day = pacificDay(now);
    if (day !== this.day) {
      this.day = day;
      this.used = 0;
    }
    if (this.used >= this.limit) return false;
    this.used += 1;
    return true;
  }
}

function pacificDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
  }).format(now);
}
