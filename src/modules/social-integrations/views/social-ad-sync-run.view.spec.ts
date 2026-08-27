import type { SocialAdSyncRunEntity } from '../entities/social-ad-sync-run.entity';
import { toSocialAdSyncRunView } from './social-ad-sync-run.view';

function run(
  overrides: Partial<SocialAdSyncRunEntity> = {},
): SocialAdSyncRunEntity {
  return {
    id: 'run-a',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: null,
    connectionId: 'connection-a',
    provider: 'meta_ads',
    runKind: 'manual',
    status: 'succeeded',
    windowStart: '2026-08-01',
    windowEnd: '2026-08-25',
    entityLevels: ['account', 'campaign', 'adset', 'ad'],
    idempotencyKey: 'connection-a:manual:2026-08-01:2026-08-25:account+ad',
    requestedById: 'user-a',
    attempts: 1,
    maxAttempts: 5,
    availableAt: new Date('2026-08-26T12:00:00Z'),
    lockedAt: null,
    lockedBy: 'ip-10-0-0-4:31337:social-sync',
    startedAt: new Date('2026-08-26T12:00:01Z'),
    finishedAt: new Date('2026-08-26T12:00:09Z'),
    rowsWritten: 34,
    rowsSkipped: 0,
    entitiesWritten: 12,
    apiCalls: 7,
    lastError: null,
    failedSegments: [],
    cursorState: {},
    retainUntil: null,
    createdAt: new Date('2026-08-26T11:59:00Z'),
    updatedAt: new Date('2026-08-26T12:00:09Z'),
    ...overrides,
  } as SocialAdSyncRunEntity;
}

describe('toSocialAdSyncRunView', () => {
  it('reports what happened', () => {
    expect(toSocialAdSyncRunView(run())).toMatchObject({
      id: 'run-a',
      connectionId: 'connection-a',
      kind: 'manual',
      status: 'succeeded',
      since: '2026-08-01',
      until: '2026-08-25',
      segments: ['hierarchy', 'account_insights', 'campaign_insights'],
      attempts: 1,
      maxAttempts: 5,
      rowsWritten: 34,
      entitiesWritten: 12,
      apiCalls: 7,
      error: null,
    });
  });

  it('never carries the lock holder, the cursor or the scope', () => {
    const view = toSocialAdSyncRunView(
      run({
        lockedBy: 'ip-10-0-0-4:31337:social-sync',
        lockedAt: new Date(),
        cursorState: { after: 'QVFIUmx4...' },
      }),
    );

    // `locked_by` maps the deployment, `cursor_state` will carry provider
    // payload the day it is used, and the scope columns tell a caller nothing
    // it did not already supply.
    expect(view).not.toHaveProperty('lockedBy');
    expect(view).not.toHaveProperty('lockedAt');
    expect(view).not.toHaveProperty('cursorState');
    expect(view).not.toHaveProperty('tenantId');
    expect(view).not.toHaveProperty('workspaceId');
    expect(view).not.toHaveProperty('agencyClientId');
    expect(view).not.toHaveProperty('idempotencyKey');
  });

  it('keeps a stored failure as its two known fields and nothing else', () => {
    const view = toSocialAdSyncRunView(
      run({
        status: 'partial',
        lastError: 'meta_rate_limited',
        failedSegments: [
          {
            segment: 'campaign_insights',
            errorCode: 'meta_rate_limited',
            // A jsonb column holds whatever was written to it. This is where
            // that stops being true.
            stack: 'Error: at MetaAdsGraphService.readEdge (/opt/...)',
            url: 'https://graph.facebook.com/v25.0/act_1/insights?access_token=EAAG',
          },
        ],
      }),
    );

    expect(view.failedSegments).toEqual([
      { segment: 'campaign_insights', errorCode: 'meta_rate_limited' },
    ]);
  });

  it('drops a stored entry that is not a segment at all', () => {
    const view = toSocialAdSyncRunView(
      run({
        failedSegments: [
          null,
          'campaign_insights',
          { segment: 'hierarchy' },
          { errorCode: 'meta_transient' },
          { segment: 'hierarchy', errorCode: 'meta_transient' },
        ] as unknown[],
      }),
    );

    expect(view.failedSegments).toEqual([
      { segment: 'hierarchy', errorCode: 'meta_transient' },
    ]);
  });

  it('survives a column that is not an array', () => {
    expect(
      toSocialAdSyncRunView(run({ failedSegments: {} as unknown as unknown[] }))
        .failedSegments,
    ).toEqual([]);
  });

  it('reads a date column whether it arrives as text or as a Date', () => {
    // Postgres hands back a string; a row still in memory holds a Date. Both
    // have to answer with the same calendar day, and the string form is the one
    // with no timezone to apply twice.
    expect(
      toSocialAdSyncRunView(
        run({
          windowStart: new Date(Date.UTC(2026, 7, 1)) as unknown as string,
          windowEnd: new Date(Date.UTC(2026, 7, 25)) as unknown as string,
        }),
      ),
    ).toMatchObject({ since: '2026-08-01', until: '2026-08-25' });
  });

  it('reports a windowless run as having no window', () => {
    expect(
      toSocialAdSyncRunView(
        run({ runKind: 'entities', windowStart: null, windowEnd: null }),
      ),
    ).toMatchObject({ since: null, until: null, segments: ['hierarchy'] });
  });

  it('does not invent segments for a kind it does not know', () => {
    expect(
      toSocialAdSyncRunView(run({ runKind: 'backfill_90d' })).segments,
    ).toEqual([]);
  });
});
