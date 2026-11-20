import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SocialAnalyticsCrmReadService } from './social-analytics-crm.read.service';
import type { LeadFactsResult } from './forms-lead-facts.read.service';

const scope = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  agencyClientId: null,
  companyContextId: null,
};
const CONNECTION = '00000000-0000-4000-8000-0000000000c1';

function harness(options: {
  provider?: string;
  current?: LeadFactsResult;
  previous?: LeadFactsResult;
  spend?: string;
  previousSpend?: string;
}) {
  const analytics = {
    listConnections: jest.fn(() =>
      Promise.resolve([
        {
          id: CONNECTION,
          provider: options.provider ?? 'google_ads',
          timezone: 'America/Sao_Paulo',
        },
      ]),
    ),
    overview: jest.fn(() =>
      Promise.resolve({
        timezone: 'America/Sao_Paulo',
        currency: 'BRL',
        current: { spend: options.spend ?? '100.000000' },
        previous: { spend: options.previousSpend ?? '0.000000' },
      }),
    ),
    campaigns: jest.fn(() =>
      Promise.resolve({
        items: [
          { externalId: '111', name: 'Campanha A', spend: '80.000000' },
          { externalId: '222', name: 'Campanha B', spend: '20.000000' },
        ],
      }),
    ),
  };
  const empty: LeadFactsResult = { qualifiedConfigured: true, facts: [] };
  const facts = jest
    .fn()
    .mockResolvedValueOnce(options.current ?? empty)
    .mockResolvedValueOnce(options.previous ?? empty);
  const service = new SocialAnalyticsCrmReadService(
    analytics as never,
    { facts } as never,
  );
  return { service, analytics, facts };
}

const fact = (
  day: string,
  campaign: string,
  leads: number,
  qualified: number | null,
  won: number,
  wonValue: string,
) => ({
  provider: 'google_ads' as const,
  connectionId: CONNECTION,
  campaignExternalId: campaign,
  day,
  leads,
  qualified,
  won,
  wonValue,
});

const input = {
  ...scope,
  connectionId: CONNECTION,
  since: '2026-11-01',
  until: '2026-11-03',
};

describe('SocialAnalyticsCrmReadService', () => {
  it('derives every quotient from the sums with the shared KPI utility', async () => {
    const { service } = harness({
      current: {
        qualifiedConfigured: true,
        facts: [
          fact('2026-11-01', '111', 3, 2, 1, '500.000000'),
          fact('2026-11-03', '111', 1, 0, 0, '0.000000'),
        ],
      },
    });

    const view = await service.read(input);

    expect(view.current).toEqual({
      leads: '4',
      qualified: '2',
      won: '1',
      wonValue: '500.000000',
      spend: '100.000000',
      costPerLead: '25.000000',
      costPerQualified: '50.000000',
      realRoas: '5.000000',
      leadToSaleRate: '25.000000',
    });
    // Nothing in the previous period: every quotient is null, never zero.
    expect(view.previous).toMatchObject({
      leads: '0',
      costPerLead: null,
      realRoas: null,
      leadToSaleRate: null,
    });
    expect(view.change.leads.percent).toBeNull();
  });

  it('keeps qualified null end to end when no stage is configured', async () => {
    const { service } = harness({
      current: {
        qualifiedConfigured: false,
        facts: [fact('2026-11-01', '111', 2, null, 0, '0.000000')],
      },
      previous: { qualifiedConfigured: false, facts: [] },
    });

    const view = await service.read(input);

    expect(view.qualifiedConfigured).toBe(false);
    expect(view.current.qualified).toBeNull();
    expect(view.current.costPerQualified).toBeNull();
    expect(view.change.qualified).toBeNull();
    expect(view.series.every((point) => point.qualified === null)).toBe(true);
  });

  it('answers one point per day, with zeros on days without leads', async () => {
    const { service } = harness({
      current: {
        qualifiedConfigured: true,
        facts: [fact('2026-11-02', '111', 2, 1, 0, '0.000000')],
      },
    });

    const view = await service.read(input);

    expect(view.series.map((point) => [point.date, point.leads])).toEqual([
      ['2026-11-01', '0'],
      ['2026-11-02', '2'],
      ['2026-11-03', '0'],
    ]);
  });

  it('lists campaigns with spend or leads, most leads first, with their own spend', async () => {
    const { service } = harness({
      current: {
        qualifiedConfigured: true,
        facts: [
          fact('2026-11-01', '222', 2, 1, 1, '10.000000'),
          fact('2026-11-01', '333', 1, 0, 0, '0.000000'),
        ],
      },
    });

    const view = await service.read(input);

    expect(
      view.campaigns.map((row) => [
        row.campaignExternalId,
        row.name,
        row.leads,
        row.spend,
      ]),
    ).toEqual([
      ['222', 'Campanha B', '2', '20.000000'],
      ['333', null, '1', '0.000000'],
      ['111', 'Campanha A', '0', '80.000000'],
    ]);
    expect(view.campaigns[0].costPerLead).toBe('10.000000');
  });

  it('reads both periods for the connection, in its time zone', async () => {
    const { service, facts } = harness({});

    await service.read(input);

    expect(facts).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        provider: 'google_ads',
        connectionId: CONNECTION,
        since: '2026-11-01',
        until: '2026-11-03',
        timezone: 'America/Sao_Paulo',
      }),
    );
    expect(facts).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ since: '2026-10-29', until: '2026-10-31' }),
    );
  });

  it('answers 404 for a connection outside the scope', async () => {
    const { service } = harness({});

    await expect(
      service.read({
        ...input,
        connectionId: '00000000-0000-4000-8000-0000000000ff',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 422 for a provider whose leads do not enter through the Forms', async () => {
    const { service } = harness({ provider: 'tiktok_ads' });

    await expect(service.read(input)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});
