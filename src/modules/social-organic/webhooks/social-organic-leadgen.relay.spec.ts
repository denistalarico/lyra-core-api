import {
  META_ORGANIC_WEBHOOK_HANDLED_FIELDS,
  META_ORGANIC_WEBHOOK_RELAYED_FIELDS,
} from './meta/meta-organic-webhook.contract';
import { resolveHandlerKey } from './meta/meta-organic-webhook.handlers';
import {
  SocialOrganicLeadgenRelay,
  isRelayedLeadgen,
  parseMetaLeadgenChange,
} from './social-organic-leadgen.relay';

const change = (value: Record<string, unknown> | null) => ({
  entryIndex: 0,
  changeIndex: 0,
  externalAssetId: '777',
  entryTime: null,
  field: 'leadgen',
  value,
});

describe('Meta leadgen relay (ML1)', () => {
  it('relays page:leadgen and nothing else', () => {
    expect([
      isRelayedLeadgen('page', 'leadgen'),
      isRelayedLeadgen('instagram', 'leadgen'),
      isRelayedLeadgen('page', 'feed'),
    ]).toEqual([true, false, false]);
  });

  it('keeps leadgen out of the interaction handler registry', () => {
    expect([
      resolveHandlerKey('page', 'leadgen'),
      [...META_ORGANIC_WEBHOOK_HANDLED_FIELDS.page],
      [...META_ORGANIC_WEBHOOK_RELAYED_FIELDS.page],
    ]).toEqual([null, ['feed', 'mention'], ['leadgen']]);
  });

  it('parses the documented ids and the unix created_time', () => {
    expect(
      parseMetaLeadgenChange(
        change({
          leadgen_id: '9001',
          page_id: '777',
          form_id: '55',
          ad_id: '301',
          adgroup_id: '201',
          created_time: 1_763_628_554,
        }),
      ),
    ).toEqual({
      leadgenId: '9001',
      pageId: '777',
      formId: '55',
      adId: '301',
      adgroupId: '201',
      createdAt: new Date(1_763_628_554_000),
    });
  });

  it('takes the Page from the entry when page_id is absent', () => {
    expect(parseMetaLeadgenChange(change({ leadgen_id: 9001 }))?.pageId).toBe(
      '777',
    );
  });

  it('refuses a change without leadgen_id', () => {
    expect(parseMetaLeadgenChange(change({ page_id: '777' }))).toBeNull();
  });

  it('settles unhandled while no module registered a sink', async () => {
    await expect(
      new SocialOrganicLeadgenRelay().relay({} as never),
    ).resolves.toEqual({
      kind: 'unhandled',
      safeErrorCode: 'no_handler_registered',
    });
  });
});
