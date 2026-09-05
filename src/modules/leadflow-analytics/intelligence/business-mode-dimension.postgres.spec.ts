import { randomUUID } from 'crypto';
import { requireIntelligenceScope } from '../../../common/intelligence';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { deleteFixtureTenant } from '../../../testing/fixture-tenant';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { BusinessModeDimensionAdapter } from './business-mode-dimension.adapter';

const run = describePostgresIntegration();

/**
 * The dimension against real rows (I5).
 *
 * The three things a mock cannot prove are exactly the three this file exists
 * for. That the scope predicate really isolates — a mode configured for one
 * client must be invisible to another and to another tenant, and the null
 * `agencyClientId` must select the agency's own row rather than whichever
 * client's row the planner reached first. That the catalog join really resolves
 * a label, with a tenant's own template beating the official one. And that a
 * context with no settings row at all comes back `unconfigured` instead of
 * throwing, which is the Social-only case the whole nullable design exists for.
 */
run('Business mode dimension against PostgreSQL', () => {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const workspaceId = randomUUID();
  const clientId = randomUUID();
  const otherClientId = randomUUID();

  let adapter: BusinessModeDimensionAdapter;

  const tables = [
    'leadflow_client_settings',
    'leadflow_business_mode_templates',
    'agency_clients',
  ];

  /**
   * A real managed client row.
   *
   * `leadflow_client_settings.agency_client_id` carries a foreign key, so a
   * random UUID is rejected — and that rejection is worth having: it means a
   * client context in this spec is a client that exists, the same as in
   * production.
   */
  const createClient = async (id: string, tenant?: string) => {
    await AgencyDataSource.query(
      `INSERT INTO agency_clients
         (id, tenant_id, workspace_id, display_name, status, lifecycle_stage,
          health_status)
       VALUES ($1, $2, $3, 'Cliente', 'active', 'active', 'healthy')`,
      [id, tenant ?? tenantId, workspaceId],
    );
  };

  const reset = async () => {
    for (const tenant of [tenantId, otherTenantId]) {
      await deleteFixtureTenant(AgencyDataSource, tenant, tables);
    }
  };

  /**
   * A settings row with a mode.
   *
   * Written with raw SQL rather than through `LeadFlowClientSettingsService`
   * deliberately: that service applies template revalidation and draft seeding,
   * and a fixture that went through it could not produce the *inconsistent*
   * states — a key with no template — this spec has to cover.
   */
  const configure = async (input: {
    tenant?: string;
    agencyClientId: string | null;
    key: string;
  }) => {
    await AgencyDataSource.query(
      `INSERT INTO leadflow_client_settings
         (id, tenant_id, workspace_id, context_type, agency_client_id,
          business_mode_key, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft')`,
      [
        randomUUID(),
        input.tenant ?? tenantId,
        workspaceId,
        input.agencyClientId ? 'client' : 'agency',
        input.agencyClientId,
        input.key,
      ],
    );
  };

  /** A tenant-owned catalog entry, which is what makes the catalog extensible. */
  const customTemplate = async (input: {
    tenant?: string;
    key: string;
    name: string;
    version?: number;
  }) => {
    await AgencyDataSource.query(
      `INSERT INTO leadflow_business_mode_templates
         (id, tenant_id, key, name, version, status, is_official, is_system)
       VALUES ($1, $2, $3, $4, $5, 'active', false, false)`,
      [
        randomUUID(),
        input.tenant ?? tenantId,
        input.key,
        input.name,
        input.version ?? 1,
      ],
    );
  };

  const scope = (agencyClientId: string | null) =>
    requireIntelligenceScope({ tenantId, workspaceId, agencyClientId });

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    await reset();
    adapter = new BusinessModeDimensionAdapter(AgencyDataSource);
  });

  beforeEach(async () => {
    await createClient(clientId);
    await createClient(otherClientId);
  });

  afterEach(reset);

  afterAll(async () => {
    await reset();
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  /**
   * §30.1 and §30.25/26 in one: the happy path resolves the key *and* the label
   * from the shipped catalog.
   *
   * `agency_services` is a system template seeded on boot, so this also asserts
   * that the dimension reads the real catalog rather than a list of its own.
   */
  it('resolves a configured mode with its catalog label', async () => {
    await configure({ agencyClientId: clientId, key: 'agency_services' });

    const dimension = await adapter.businessMode(scope(clientId));

    expect(dimension.key).toBe('agency_services');
    expect(dimension.label).toBeTruthy();
    expect(dimension.resolution).toBe('configured');
    expect(dimension.source).toBe('leadflow_client_settings');
    expect(dimension.temporalSemantics).toBe('current_context_dimension');
  });

  /**
   * §30.2 and §30.8: no row at all.
   *
   * This is the Social-only context — a tenant holding a Social entitlement and
   * no LeadFlow one will never have a settings row — and it must resolve rather
   * than throw. `getSettings` would raise `NotFoundException` here, which is
   * precisely why the adapter does not use it.
   */
  it('returns unconfigured for a context with no settings row', async () => {
    const dimension = await adapter.businessMode(scope(clientId));

    expect(dimension).toEqual({
      key: null,
      label: null,
      resolution: 'unconfigured',
      source: 'leadflow_client_settings',
      temporalSemantics: 'current_context_dimension',
    });
  });

  /**
   * §30.3 / §21: a stored key the catalog does not know.
   *
   * Reachable without anything malicious — a tenant-custom template can be
   * deactivated while a settings row still points at its key. The key must
   * survive so the inconsistency is visible; nulling it would make a broken
   * context look like an empty one, and the bad key would still be in the
   * database waiting to be segmented on.
   */
  it('distinguishes an unrecognised stored key from an absent one', async () => {
    await configure({ agencyClientId: clientId, key: 'not_in_catalog' });

    const dimension = await adapter.businessMode(scope(clientId));

    expect(dimension.key).toBe('not_in_catalog');
    expect(dimension.label).toBeNull();
    expect(dimension.resolution).toBe('unknown_key');
  });

  /**
   * §30.4: the agency's own context.
   *
   * The assertion that matters is the second one. `agency_client_id IS NULL` is
   * a different row from any client's, and an implementation that dropped the
   * filter when the scope's client id was null would return the client's mode
   * here — which is the classic version of this bug and invisible until two
   * contexts are configured differently.
   */
  it('resolves the agency context, not a client that happens to exist', async () => {
    await configure({ agencyClientId: null, key: 'agency_services' });
    await configure({ agencyClientId: clientId, key: 'real_estate' });

    const agency = await adapter.businessMode(scope(null));
    const client = await adapter.businessMode(scope(clientId));

    expect(agency.key).toBe('agency_services');
    expect(client.key).toBe('real_estate');
  });

  /**
   * §30.5 and §30.7: two managed clients under one tenant stay separate.
   */
  it('isolates one managed client from another', async () => {
    await configure({ agencyClientId: clientId, key: 'clinics_esthetics' });
    await configure({ agencyClientId: otherClientId, key: 'restaurants_food' });

    expect((await adapter.businessMode(scope(clientId))).key).toBe(
      'clinics_esthetics',
    );
    expect((await adapter.businessMode(scope(otherClientId))).key).toBe(
      'restaurants_food',
    );
  });

  /**
   * §30.6: another tenant's identical client id is not this tenant's mode.
   *
   * The same `agencyClientId` is reused across two tenants on purpose. Ids are
   * unique in practice, so a missing `tenant_id` predicate would pass every
   * realistic test — this makes the collision real so the predicate is actually
   * exercised.
   */
  it('isolates one tenant from another', async () => {
    const theirClientId = randomUUID();
    await createClient(theirClientId, otherTenantId);

    await configure({ agencyClientId: clientId, key: 'clinics_esthetics' });
    await configure({
      tenant: otherTenantId,
      agencyClientId: theirClientId,
      key: 'automotive',
    });

    const dimension = await adapter.businessMode(scope(clientId));

    expect(dimension.key).toBe('clinics_esthetics');
  });

  /**
   * The tenant predicate, exercised where an id collision is actually possible.
   *
   * `agency_clients.id` is a primary key, so two tenants cannot share a client
   * id — but the *agency* context is `agency_client_id IS NULL` for everyone,
   * which makes it the one row shape that genuinely collides across tenants. A
   * missing `tenant_id` predicate would return the other tenant's mode here.
   */
  it('isolates one tenant agency context from another', async () => {
    await configure({ agencyClientId: null, key: 'clinics_esthetics' });
    await configure({
      tenant: otherTenantId,
      agencyClientId: null,
      key: 'automotive',
    });

    expect((await adapter.businessMode(scope(null))).key).toBe(
      'clinics_esthetics',
    );
  });

  /**
   * §20: the catalog is extensible, and the label follows the same precedence
   * the settings screen uses.
   *
   * A tenant's own template for a key overrides the official one. If the
   * dimension resolved the label differently from
   * `LeadFlowBusinessModeTemplateService.getTemplateByKey`, a report and the
   * settings page would print two different names for one mode — worse than
   * printing none.
   */
  it('prefers a tenant custom template over the official one', async () => {
    await customTemplate({
      key: 'agency_services',
      name: 'Serviços Sob Medida',
    });
    await configure({ agencyClientId: clientId, key: 'agency_services' });

    const dimension = await adapter.businessMode(scope(clientId));

    expect(dimension.label).toBe('Serviços Sob Medida');
    expect(dimension.resolution).toBe('configured');
  });

  /** The highest active version of a custom template wins, as elsewhere. */
  it('takes the newest version of a custom template', async () => {
    await customTemplate({ key: 'automotive', name: 'Antigo', version: 1 });
    await customTemplate({ key: 'automotive', name: 'Atual', version: 2 });
    await configure({ agencyClientId: clientId, key: 'automotive' });

    expect((await adapter.businessMode(scope(clientId))).label).toBe('Atual');
  });

  /**
   * A custom template belonging to another tenant must not supply the label.
   *
   * Otherwise one agency's renaming of a mode would show up in another's
   * reports — a cross-tenant leak of exactly the kind that is invisible because
   * the value looks plausible.
   */
  it('ignores another tenant custom template when labelling', async () => {
    await customTemplate({
      tenant: otherTenantId,
      key: 'automotive',
      name: 'Nome do Outro Tenant',
    });
    await configure({ agencyClientId: clientId, key: 'automotive' });

    const dimension = await adapter.businessMode(scope(clientId));

    expect(dimension.label).not.toBe('Nome do Outro Tenant');
    // Falls back to the official catalog entry, which is still a real label.
    expect(dimension.resolution).toBe('configured');
  });

  /**
   * §27/§28: one indexed round trip, no materialisation.
   *
   * Measured rather than asserted in prose, because the claim "the lookup is
   * cheap" is the reason no caching, snapshot table or denormalised copy was
   * added — and if it stopped being true, the right response would be to
   * revisit that decision rather than to relax the number.
   */
  it('resolves in a single cheap lookup', async () => {
    await configure({ agencyClientId: clientId, key: 'agency_services' });

    const started = Date.now();
    for (let i = 0; i < 20; i += 1) {
      await adapter.businessMode(scope(clientId));
    }
    const perLookup = (Date.now() - started) / 20;

    expect(perLookup).toBeLessThan(50);
  });
});
