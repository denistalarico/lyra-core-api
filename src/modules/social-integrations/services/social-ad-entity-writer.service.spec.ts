import { getMetadataArgsStorage } from 'typeorm';
import { SocialAdEntity } from '../entities/social-ad-entity.entity';
import {
  IDENTITY_COLUMNS,
  REFRESHED_COLUMNS,
} from './social-ad-entity-writer.service';

/**
 * The upsert's contract, checked without a database.
 *
 * What this file guards is a list — and a list is exactly the kind of thing
 * that gets a line appended to it by someone who has not read why the missing
 * entries are missing. The behavioural proof lives in the PostgreSQL spec; this
 * one runs everywhere and fails the moment the shape drifts.
 */
describe('social ad entity upsert shape', () => {
  const declared = getMetadataArgsStorage()
    .columns.filter((column) => column.target === SocialAdEntity)
    .map((column) => column.options.name ?? column.propertyName);

  it('conflicts on the identity the unique index actually enforces', () => {
    const identity = getMetadataArgsStorage().indices.find(
      (index) =>
        index.target === SocialAdEntity &&
        index.name === 'UQ_social_ad_entities_identity',
    );

    // `ON CONFLICT` needs a unique index to match; naming columns that are not
    // one is a runtime error on the first write, not a compile error.
    expect(identity?.unique).toBe(true);
    expect(identity?.columns).toEqual([
      'tenantId',
      'workspaceId',
      'connectionId',
      'entityLevel',
      'externalId',
    ]);
    expect(IDENTITY_COLUMNS).toEqual([
      'tenant_id',
      'workspace_id',
      'connection_id',
      'entity_level',
      'external_id',
    ]);
  });

  it('never refreshes first_seen_at', () => {
    // It answers "since when has Lyra known this object". A sync that
    // overwrote it would reset that answer to today, on every run, forever.
    expect(REFRESHED_COLUMNS).not.toContain('first_seen_at');
  });

  it('never writes the identity to itself', () => {
    for (const column of IDENTITY_COLUMNS) {
      expect(REFRESHED_COLUMNS).not.toContain(column);
    }
  });

  it('refreshes freshness and clears the archive marker', () => {
    // The reappearance rule, executed by the same statement as the refresh:
    // every insert supplies `archived_at = NULL`, so there is no window in
    // which a returning object is both present and archived.
    expect(REFRESHED_COLUMNS).toContain('last_seen_at');
    expect(REFRESHED_COLUMNS).toContain('archived_at');
    expect(REFRESHED_COLUMNS).toContain('updated_at');
  });

  it('refreshes every mutable column the provider can change', () => {
    // A column the provider owns but the upsert forgets is a value frozen at
    // whatever it was the first time the object was seen — a paused campaign
    // that still reads ACTIVE months later.
    const providerOwned = [
      'name',
      'status',
      'effective_status',
      'objective',
      'optimization_goal',
      'billing_event',
      'daily_budget_minor',
      'lifetime_budget_minor',
      'budget_remaining_minor',
      'currency',
      'start_time',
      'stop_time',
      'provider_created_time',
      'provider_updated_time',
      'parent_external_id',
      'campaign_external_id',
    ];

    for (const column of providerOwned) {
      expect(declared).toContain(column);
      expect(REFRESHED_COLUMNS).toContain(column);
    }
  });

  it('names only columns that exist', () => {
    for (const column of [...REFRESHED_COLUMNS, ...IDENTITY_COLUMNS]) {
      expect(declared).toContain(column);
    }
  });

  it('leaves raw unwritten in this slice', () => {
    // Storing every payload of every object on every sync grows without bound,
    // and nothing here implements retention.
    expect(REFRESHED_COLUMNS).not.toContain('raw');
  });
});
