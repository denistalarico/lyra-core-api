import { getMetadataArgsStorage } from 'typeorm';
import { SocialAdMetricDailyEntity } from '../entities/social-ad-metric-daily.entity';
import {
  METRIC_IDENTITY_COLUMNS,
  REFRESHED_METRIC_COLUMNS,
} from './social-ad-metrics-writer.service';

/**
 * The upsert lists, checked against the schema they claim to describe.
 *
 * These two arrays are strings handed to `orUpdate`, so a typo or a stale name
 * is not a type error — it becomes a runtime failure, or worse, a column that
 * silently stops being refreshed. Reading the entity's own metadata is what
 * turns that back into a compile-time-ish check.
 */
const COLUMNS = getMetadataArgsStorage()
  .columns.filter((column) => column.target === SocialAdMetricDailyEntity)
  .map(
    (column) =>
      column.options.name ??
      column.propertyName.replace(
        /[A-Z]/g,
        (letter) => `_${letter.toLowerCase()}`,
      ),
  );

/** The unique index this upsert conflicts on, as the entity declares it. */
const UNIQUE_INDEX = getMetadataArgsStorage().indices.find(
  (index) =>
    index.target === SocialAdMetricDailyEntity &&
    index.name === 'UQ_social_ad_metrics_daily_fact',
);

describe('social ad metrics upsert lists', () => {
  it('conflicts on exactly the declared unique index', () => {
    const declared = (UNIQUE_INDEX?.columns as string[]).map((property) =>
      property.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
    );

    // An ON CONFLICT target that does not match a unique index is a runtime
    // error; one that matches a *different* index would silently redefine what
    // "the same fact" means.
    expect(METRIC_IDENTITY_COLUMNS).toEqual(declared);
  });

  it('keeps source and attribution setting in the identity', () => {
    // They are different ways of measuring the same object on the same day, not
    // corrections of each other. Dropping either would let a future 7-day-click
    // pull overwrite numbers already reported to a client.
    expect(METRIC_IDENTITY_COLUMNS).toContain('source');
    expect(METRIC_IDENTITY_COLUMNS).toContain('attribution_setting');
  });

  it('never refreshes created_at', () => {
    // It answers "when did Lyra first record this day". Re-reading a window
    // must not reset that to today.
    expect(REFRESHED_METRIC_COLUMNS).not.toContain('created_at');
  });

  it('never writes an identity column to itself', () => {
    for (const column of METRIC_IDENTITY_COLUMNS) {
      expect(REFRESHED_METRIC_COLUMNS).not.toContain(column);
    }
  });

  it('refreshes every measured column, since Meta restates recent days', () => {
    for (const column of [
      'spend',
      'impressions',
      'reach',
      'clicks',
      'link_clicks',
      'leads',
      'conversions',
      'conversion_value',
      'video_views',
      'actions',
      'is_partial',
    ]) {
      expect(REFRESHED_METRIC_COLUMNS).toContain(column);
    }
  });

  it('refreshes synced_at, which is the only record of when a restatement landed', () => {
    expect(REFRESHED_METRIC_COLUMNS).toContain('synced_at');
    expect(REFRESHED_METRIC_COLUMNS).toContain('updated_at');
  });

  it('leaves the columns this slice does not produce alone', () => {
    // A column listed here would be overwritten with the NULL this writer
    // inserts, erasing whatever a later writer had put there.
    expect(REFRESHED_METRIC_COLUMNS).not.toContain('raw');
    expect(REFRESHED_METRIC_COLUMNS).not.toContain('sync_run_id');
  });

  it('names only columns that exist', () => {
    for (const column of [
      ...REFRESHED_METRIC_COLUMNS,
      ...METRIC_IDENTITY_COLUMNS,
    ]) {
      expect(COLUMNS).toContain(column);
    }
  });
});
