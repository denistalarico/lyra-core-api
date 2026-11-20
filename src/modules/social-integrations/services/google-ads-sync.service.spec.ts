import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import type {
  GoogleAdsRawHierarchy,
  GoogleAdsRawPage,
  GoogleAdsReaderService,
} from './google-ads-reader.service';
import { GoogleAdsSyncService } from './google-ads-sync.service';
import type { SocialAdEntityWriterService } from './social-ad-entity-writer.service';
import type { SocialAdMetricsWriterService } from './social-ad-metrics-writer.service';
import type { SocialAdBreakdownWriterService } from './social-ad-breakdown-writer.service';
import type { SocialAdSearchTermWriterService } from './social-ad-search-term-writer.service';

const CREDENTIAL = {
  connectionId: 'c',
  tenantId: 't',
  workspaceId: 'w',
  agencyClientId: null,
  provider: 'google_ads',
  externalAccountId: '1234567890',
  currency: 'BRL',
} as unknown as ResolvedAdCredential;

const page = (
  rows: Array<Record<string, unknown>>,
  truncated = false,
): GoogleAdsRawPage => ({ rows, truncated, apiCalls: 1 });

function build(assetGroupsTruncated = false) {
  const hierarchy: GoogleAdsRawHierarchy = {
    account: page([{ customer: { id: '1234567890' } }]),
    campaigns: page([{ campaign: { id: '11' } }, { campaign: { id: '12' } }]),
    adGroups: page([{ adGroup: { id: '21' }, campaign: { id: '11' } }]),
    assetGroups: page(
      [{ assetGroup: { id: '31' }, campaign: { id: '12' } }],
      assetGroupsTruncated,
    ),
    ads: page([]),
  };
  const reader = {
    readHierarchy: jest.fn(async () => hierarchy),
  } as unknown as GoogleAdsReaderService;
  const entityWriter = {
    upsert: jest.fn(async (input: { rows: unknown[] }) => input.rows.length),
    archiveMissing: jest.fn(async () => 0),
  };
  const service = new GoogleAdsSyncService(
    reader,
    entityWriter as unknown as SocialAdEntityWriterService,
    {} as SocialAdMetricsWriterService,
    {} as SocialAdBreakdownWriterService,
    {} as SocialAdSearchTermWriterService,
  );

  return { service, entityWriter };
}

const adsetUpsert = (writer: ReturnType<typeof build>['entityWriter']) =>
  (
    writer.upsert.mock.calls as unknown as Array<
      [{ rows: Array<{ entityLevel: string; externalId: string }> }]
    >
  )
    .map(([input]) => input.rows)
    .filter((rows) => rows[0]?.entityLevel === 'adset');

describe('GoogleAdsSyncService — asset groups (D-G1)', () => {
  it('writes ad groups and asset groups in one adset pass', async () => {
    const { service, entityWriter } = build();

    await service.syncHierarchyWith(CREDENTIAL);

    expect(
      adsetUpsert(entityWriter).map((rows) => rows.map((r) => r.externalId)),
    ).toEqual([['21', '31']]);
  });

  it('archives the adset level once, after both kinds were seen', async () => {
    const { service, entityWriter } = build();

    await service.syncHierarchyWith(CREDENTIAL);

    const levels = (
      entityWriter.archiveMissing.mock.calls as unknown as Array<
        [{ entityLevel: string }]
      >
    ).map(([input]) => input.entityLevel);
    expect(levels.filter((level) => level === 'adset')).toHaveLength(1);
  });

  it('never archives the adset level when the asset-group half was truncated', async () => {
    const { service, entityWriter } = build(true);

    await service.syncHierarchyWith(CREDENTIAL);

    const levels = (
      entityWriter.archiveMissing.mock.calls as unknown as Array<
        [{ entityLevel: string }]
      >
    ).map(([input]) => input.entityLevel);
    expect(levels).not.toContain('adset');
  });

  it('counts both queries of the adset level', async () => {
    const { service } = build();

    const summary = await service.syncHierarchyWith(CREDENTIAL);

    expect(summary.levels.find((level) => level.level === 'adset')).toEqual(
      expect.objectContaining({ read: 2, apiCalls: 2 }),
    );
  });
});
