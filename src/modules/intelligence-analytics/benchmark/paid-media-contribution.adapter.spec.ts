import type { BusinessModeDimension } from '../../../common/intelligence';
import type { BusinessModeDimensionAdapter } from '../../leadflow-analytics/intelligence/business-mode-dimension.adapter';
import type { TelemetryContributionRegistry } from '../../leadflow-privacy';
import { PaidMediaContributionAdapter } from './paid-media-contribution.adapter';
import type { PaidMediaContributionService } from './paid-media-contribution.service';

/**
 * The eligibility gate between consent and arithmetic.
 *
 * Everything here is about *whether* a context's paid media may join a
 * cross-tenant cohort. The arithmetic itself is proven in
 * `paid-media-contribution.service.spec`, and consent in the collector's specs.
 */
describe('PaidMediaContributionAdapter', () => {
  const scope = {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    agencyClientId: null,
  };

  const dimension = (
    overrides: Partial<BusinessModeDimension>,
  ): BusinessModeDimension => ({
    key: 'agency_services',
    label: 'Agência de serviços',
    resolution: 'configured',
    source: 'leadflow_client_settings',
    temporalSemantics: 'current_context_dimension',
    ...overrides,
  });

  const build = (mode: BusinessModeDimension) => {
    const buildContributions = jest.fn().mockResolvedValue([
      {
        observedOn: '2026-09-01',
        metricKey: 'paid_impressions',
        dimensionKey: 'v1|bm=agency_services|p=meta|d=whatsapp',
        metricValue: '100',
      },
    ]);
    const register = jest.fn();

    const adapter = new PaidMediaContributionAdapter(
      { buildContributions } as unknown as PaidMediaContributionService,
      {
        businessMode: jest.fn().mockResolvedValue(mode),
      } as unknown as BusinessModeDimensionAdapter,
      { register } as unknown as TelemetryContributionRegistry,
    );

    return { adapter, buildContributions, register };
  };

  const run = (mode: BusinessModeDimension) => {
    const fixture = build(mode);

    return {
      ...fixture,
      result: fixture.adapter.buildContributions({
        scope,
        since: '2026-09-01',
        until: '2026-09-02',
      }),
    };
  };

  describe('business mode eligibility', () => {
    it('contributes for a system-defined mode', async () => {
      const { result, buildContributions } = run(dimension({}));

      await expect(result).resolves.toHaveLength(1);
      expect(buildContributions).toHaveBeenCalledWith(
        expect.objectContaining({ businessModeKey: 'agency_services' }),
      );
    });

    /**
     * A tenant-custom mode contributes nothing — not an `unknown` cohort.
     *
     * The catalog is tenant-extensible, so a custom key is recognised by the
     * *catalog* (`resolution: 'configured'`, a real label) while still being
     * meaningless across tenants. This is the case most likely to be got wrong,
     * because every field on the dimension says the mode is fine.
     */
    it('excludes a tenant-custom mode the catalog recognises', async () => {
      const { result, buildContributions } = run(
        dimension({ key: 'clinicas_do_joao', label: 'Clínicas do João' }),
      );

      await expect(result).resolves.toEqual([]);
      expect(buildContributions).not.toHaveBeenCalled();
    });

    it('excludes an unknown key', async () => {
      const { result, buildContributions } = run(
        dimension({
          key: 'deleted_template',
          label: null,
          resolution: 'unknown_key',
        }),
      );

      await expect(result).resolves.toEqual([]);
      expect(buildContributions).not.toHaveBeenCalled();
    });

    it('excludes an unconfigured context', async () => {
      const { result, buildContributions } = run(
        dimension({ key: null, label: null, resolution: 'unconfigured' }),
      );

      await expect(result).resolves.toEqual([]);
      expect(buildContributions).not.toHaveBeenCalled();
    });

    /**
     * §4: no mapping from custom to official, by label or otherwise.
     *
     * A custom mode whose label is *identical* to an official mode's still
     * contributes nothing. Two tenants that both typed "Agência de serviços"
     * have not agreed on what it means.
     */
    it('does not map a custom mode onto an official one by label', async () => {
      const { result } = run(
        dimension({ key: 'minha_agencia', label: 'Agência de serviços' }),
      );

      await expect(result).resolves.toEqual([]);
    });
  });

  /**
   * §6: the mode is stamped at contribution time and never reapplied backwards.
   *
   * Two calls with different current modes produce differently-labelled rows,
   * and nothing in the adapter can revisit the first call's output.
   */
  it('stamps the mode current at contribution time', async () => {
    const first = build(dimension({}));
    await first.adapter.buildContributions({
      scope,
      since: '2026-09-01',
      until: '2026-09-01',
    });

    const second = build(
      dimension({ key: 'real_estate', label: 'Imobiliária' }),
    );
    await second.adapter.buildContributions({
      scope,
      since: '2026-09-02',
      until: '2026-09-02',
    });

    expect(first.buildContributions).toHaveBeenCalledWith(
      expect.objectContaining({ businessModeKey: 'agency_services' }),
    );
    expect(second.buildContributions).toHaveBeenCalledWith(
      expect.objectContaining({ businessModeKey: 'real_estate' }),
    );
  });

  it('passes the window through without widening it', async () => {
    const { adapter, buildContributions } = build(dimension({}));

    await adapter.buildContributions({
      scope,
      since: '2026-08-06',
      until: '2026-09-04',
    });

    expect(buildContributions).toHaveBeenCalledWith(
      expect.objectContaining({ since: '2026-08-06', until: '2026-09-04' }),
    );
  });

  it('carries the managed client through as its own scope', async () => {
    const { adapter, buildContributions } = build(dimension({}));

    await adapter.buildContributions({
      scope: { ...scope, agencyClientId: 'client-9' },
      since: '2026-09-01',
      until: '2026-09-01',
    });

    const [input] = buildContributions.mock.calls[0] as [
      { scope: { agencyClientId: string | null } },
    ];

    expect(input.scope.agencyClientId).toBe('client-9');
  });

  describe('registration', () => {
    it('announces itself to the registry on init', () => {
      const { adapter, register } = build(dimension({}));

      adapter.onModuleInit();

      expect(register).toHaveBeenCalledWith(adapter);
    });

    it('names the domain rather than the metric family', () => {
      const { adapter } = build(dimension({}));

      expect(adapter.contributionSourceKey).toBe('social_paid_media');
    });
  });
});
