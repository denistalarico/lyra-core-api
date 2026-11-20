import { NotFoundException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { DataSource } from 'typeorm';
import { GoogleCampaignDetailsReadService } from './google-campaign-details-read.service';

const SCOPE = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  agencyClientId: null,
  companyContextId: null,
};

const INPUT = {
  ...SCOPE,
  connectionId: '00000000-0000-4000-8000-000000000003',
  campaignId: '24460619718',
  since: '2026-11-13',
  until: '2026-11-19',
};

type Rows = {
  connection?: unknown[];
  campaign?: unknown[];
  totals?: unknown[];
  breakdowns?: unknown[];
  terms?: unknown[];
};

function build(rows: Rows = {}) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('FROM social_ad_account_connections')) {
      return rows.connection ?? [{ id: INPUT.connectionId }];
    }
    if (sql.includes('FROM social_ad_entities')) {
      return rows.campaign ?? [{ channel_type: 'PERFORMANCE_MAX' }];
    }
    if (sql.includes('FROM social_ad_metrics_daily')) {
      return (
        rows.totals ?? [
          {
            spend: '15.480000',
            impressions: '19',
            clicks: '4',
            conversions: '2.000000',
            conversion_value: '0.000000',
            partial_days: '0',
          },
        ]
      );
    }
    if (sql.includes('FROM social_ad_breakdown_daily')) {
      return rows.breakdowns ?? [];
    }
    return rows.terms ?? [];
  });
  const service = new GoogleCampaignDetailsReadService({
    query,
  } as unknown as DataSource);
  return { service, query };
}

const network = (key: string, spend: string, conversions: string) => ({
  breakdown_kind: 'ad_network',
  breakdown_key: key,
  label: null,
  category: null,
  spend,
  impressions: '1',
  clicks: '1',
  conversions,
  conversion_value: '0',
});

describe('GoogleCampaignDetailsReadService (GA-DET)', () => {
  it('labels channels and puts the most spend first', async () => {
    const { service } = build({
      breakdowns: [
        network('search', '2.000000', '0'),
        network('youtube', '10.000000', '1'),
      ],
    });
    const view = await service.read(INPUT);
    expect(view.channels.map((row) => [row.key, row.label])).toEqual([
      ['youtube', 'YouTube'],
      ['search', 'Pesquisa Google'],
    ]);
  });

  it('explains the part of the total Google did not split by channel', async () => {
    const { service } = build({
      breakdowns: [network('youtube', '10.000000', '1.5')],
    });
    expect((await service.read(INPUT)).unattributed).toEqual({
      conversions: '0.500000',
      spend: '5.480000',
    });
  });

  it('never reports a negative unattributed part', async () => {
    const { service } = build({
      breakdowns: [network('youtube', '99.000000', '9')],
    });
    expect((await service.read(INPUT)).unattributed).toEqual({
      conversions: '0.000000',
      spend: '0.000000',
    });
  });

  it('returns conversion actions with no spend (no CPA per action)', async () => {
    const { service } = build({
      breakdowns: [
        {
          breakdown_kind: 'conversion_action',
          breakdown_key: '987',
          label: 'Envio de formulário',
          category: 'SUBMIT_LEAD_FORM',
          spend: '0',
          impressions: '0',
          clicks: '0',
          conversions: '2.000000',
          conversion_value: '0',
        },
      ],
    });
    expect((await service.read(INPUT)).conversionActions).toEqual([
      {
        id: '987',
        label: 'Envio de formulário',
        category: 'SUBMIT_LEAD_FORM',
        conversions: '2.000000',
        conversionValue: '0.000000',
        spend: null,
      },
    ]);
  });

  it('defaults a PMax campaign to its search categories, daily', async () => {
    const { service, query } = build();
    const view = await service.read(INPUT);
    const termsCall = query.mock.calls.find(([sql]) =>
      String(sql).includes('FROM social_ad_search_terms_daily'),
    ) as unknown as [string, unknown[]];
    expect([view.terms.kind, view.terms.grain, termsCall[1][5]]).toEqual([
      'pmax_category',
      'daily',
      'pmax_category',
    ]);
  });

  it('defaults a Search campaign to search terms', async () => {
    const { service } = build({ campaign: [{ channel_type: 'SEARCH' }] });
    expect((await service.read(INPUT)).terms.kind).toBe('search_term');
  });

  it('keeps a term spend null when Google reported none', async () => {
    const { service } = build({
      terms: [
        {
          term_text: 'categoria fictícia',
          impressions: '7',
          clicks: '1',
          spend: null,
          conversions: '1',
          conversion_value: '0',
        },
      ],
    });
    expect((await service.read(INPUT)).terms.rows[0].spend).toBeNull();
  });

  it('is not found for a connection outside the exact scope', async () => {
    const { service } = build({ connection: [] });
    await expect(service.read(INPUT)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('is not found for a campaign id that is not a Google id', async () => {
    const { service, query } = build();
    await expect(
      service.read({ ...INPUT, campaignId: 'abc' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(query).not.toHaveBeenCalled();
  });

  it('binds the company context when finding the connection', async () => {
    const { service, query } = build();
    await service.read({ ...INPUT, companyContextId: 'ctx-1' });
    expect((query.mock.calls[0] as unknown as [string, unknown[]])[1][4]).toBe(
      'ctx-1',
    );
  });

  it('has no route to provider calls or credentials', () => {
    const source = readFileSync(
      join(__dirname, 'google-campaign-details-read.service.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(
      [
        'CredentialResolver',
        'GoogleAdsReader',
        'accessToken',
        'fetch(',
        'axios',
        'enqueue',
      ].filter((forbidden) => source.includes(forbidden)),
    ).toEqual([]);
  });
});
