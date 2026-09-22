/**
 * CC2G — the reconciliation domain registry.
 *
 * Each migrated CC2C–CC2F root is described here as data rather than as a
 * hand-written adapter class. The transversal logic (counting, listing,
 * candidate resolution, validation, assignment, audit) lives once in
 * `CompanyLegacyReconciliationService`; this file only says, per domain,
 * *where* the row lives and *what is safe to show*.
 *
 * Adding a boundary later means adding one entry, not a new service.
 *
 * ── The two legacy shapes ────────────────────────────────────────────────
 *
 * CC2C–CC2F did not encode legacy the same way everywhere, and the database
 * CHECK constraints enforce the difference, so reconciliation has to respect
 * both:
 *
 * `scopeKind: 'column'` — CC2E/CC2F roots that gained `scope_kind`
 *   (inbox + CRM + scheduled items). Legacy is
 *   `scope_kind = 'legacy_unassigned'`, and BOTH `agency_client_id` and
 *   `company_context_id` are NULL. The row does not know its own client, so
 *   assignment must write the client, the company AND flip `scope_kind` to
 *   `'company'` in one statement — the CHECK constraint rejects any partial
 *   combination, which is exactly the guarantee we want.
 *
 * `scopeKind: 'implicit'` — Social (CC2C/CC2D) plus the four LeadFlow roots
 *   that already had `agency_client_id` (agents, automations, views,
 *   recommendations). Legacy is `agency_client_id IS NOT NULL AND
 *   company_context_id IS NULL`. The client is already known and therefore
 *   constrains the candidate companies by itself.
 *
 * ── Why `possibleCompanies` is empty for 'column' domains ────────────────
 *
 * A `'column'` legacy row carries no Agency Client. Offering every company in
 * the workspace would be exactly the indiscriminate guess CC2G forbids, so
 * those rows are reported as `requires_manual_research` unless a persisted
 * parent supplies the account (see `parentEvidence`).
 */

/** Product bucket, used only for filtering the admin list. */
export type CompanyLegacyProduct = 'social' | 'leadflow';

/**
 * How a domain's legacy state is encoded. See the file header.
 */
export type CompanyLegacyScopeEncoding = 'column' | 'implicit';

/**
 * A persisted, mandatory relation to a parent that is already company-scoped.
 *
 * This is the ONLY automatic-reconciliation evidence CC2G accepts. It must be
 * a NOT NULL foreign key to a root that itself carries
 * `agency_client_id`/`company_context_id`, so the child's ownership is a fact
 * of the schema rather than an inference. A nullable parent can still narrow
 * the candidate list, but never auto-assigns — hence `automatic`.
 */
export type CompanyLegacyParentEvidence = {
  /** Column on the legacy table holding the parent id. */
  column: string;
  /** Parent table carrying the company scope. */
  table: string;
  /**
   * `true` only when the column is NOT NULL and the parent is guaranteed
   * company-scoped. Drives automatic reconciliation; `false` only narrows
   * `possibleCompanies`.
   */
  automatic: boolean;
};

export type CompanyLegacyDomain = {
  /** Stable, human-readable key used in routes and in the audit log. */
  domainKey: string;
  product: CompanyLegacyProduct;
  /** Physical table holding the root. */
  table: string;
  scopeEncoding: CompanyLegacyScopeEncoding;
  /** Label shown in the admin UI. */
  label: string;
  /**
   * Column projected as `title`. Never a secret: the registry only ever
   * points at names/labels the operator already sees elsewhere.
   */
  titleColumn: string | null;
  /**
   * Extra non-sensitive columns projected into `summary` to make the decision
   * possible. Message bodies, tokens and credentials are never listed here.
   */
  summaryColumns: readonly string[];
  /** Excludes soft-deleted rows from the inventory when present. */
  softDeleteColumn?: string;
  /**
   * Column projected as `createdAt` and used to order the inventory.
   *
   * Defaults to `created_at`, which every root carries except
   * `inbox_autonomy_controls` — a single mutable control row per scope, which
   * records only `updated_at`. Declared here rather than special-cased in the
   * service so the registry stays the one description of each table's shape.
   */
  timestampColumn?: string;
  parentEvidence?: CompanyLegacyParentEvidence;
};

export const COMPANY_LEGACY_DOMAINS: readonly CompanyLegacyDomain[] = [
  // ── Social (CC2C / CC2D) ───────────────────────────────────────────────
  {
    domainKey: 'social.planner.plan',
    product: 'social',
    table: 'social_plans',
    scopeEncoding: 'implicit',
    label: 'Plano editorial',
    titleColumn: 'title',
    summaryColumns: ['period_start', 'period_end', 'status'],
    softDeleteColumn: 'deleted_at',
  },
  {
    domainKey: 'social.brand-kit',
    product: 'social',
    table: 'brand_kits',
    scopeEncoding: 'implicit',
    label: 'Brand Kit',
    titleColumn: null,
    summaryColumns: [],
  },
  {
    domainKey: 'social.creative.folder',
    product: 'social',
    table: 'social_creative_folders',
    scopeEncoding: 'implicit',
    label: 'Pasta do Creative Studio',
    titleColumn: 'name',
    summaryColumns: [],
  },
  {
    domainKey: 'social.creative.asset',
    product: 'social',
    table: 'social_creative_assets',
    scopeEncoding: 'implicit',
    label: 'Asset do Creative Studio',
    titleColumn: 'name',
    summaryColumns: ['asset_type'],
    // `folder_id` is nullable, so it can only narrow the candidates.
    parentEvidence: {
      column: 'folder_id',
      table: 'social_creative_folders',
      automatic: false,
    },
  },
  {
    domainKey: 'social.organic.asset',
    product: 'social',
    table: 'social_organic_assets',
    scopeEncoding: 'implicit',
    label: 'Perfil orgânico conectado',
    titleColumn: 'display_name',
    summaryColumns: ['provider', 'asset_type', 'username'],
    // NOTE: `connection_id` is NOT NULL, but `social_organic_connections` was
    // never company-scoped (it has `agency_client_id` only), so it is not
    // usable evidence. Deliberately absent.
  },
  {
    domainKey: 'social.ads.connection',
    product: 'social',
    table: 'social_ad_account_connections',
    scopeEncoding: 'implicit',
    label: 'Conexão de Meta Ads',
    titleColumn: 'account_name',
    summaryColumns: ['provider', 'connection_status', 'external_account_id'],
  },
  {
    domainKey: 'social.boost.template',
    product: 'social',
    table: 'social_boost_templates',
    scopeEncoding: 'implicit',
    label: 'Template de impulsionamento',
    titleColumn: 'name',
    summaryColumns: ['provider', 'objective'],
  },

  // ── LeadFlow settings & inbox (CC2E) ───────────────────────────────────
  {
    domainKey: 'leadflow.settings',
    product: 'leadflow',
    table: 'leadflow_client_settings',
    scopeEncoding: 'implicit',
    label: 'Configuração do LeadFlow',
    titleColumn: null,
    summaryColumns: ['business_mode_key'],
  },
  {
    domainKey: 'leadflow.inbox.settings',
    product: 'leadflow',
    table: 'inbox_settings',
    scopeEncoding: 'column',
    label: 'Configuração do Inbox',
    titleColumn: null,
    summaryColumns: [],
  },
  {
    domainKey: 'leadflow.inbox.autonomy',
    product: 'leadflow',
    table: 'inbox_autonomy_controls',
    scopeEncoding: 'column',
    label: 'Controle de autonomia',
    titleColumn: null,
    summaryColumns: ['reason_code', 'paused_at'],
    timestampColumn: 'updated_at',
  },
  {
    domainKey: 'leadflow.inbox.channel',
    product: 'leadflow',
    table: 'inbox_channels',
    scopeEncoding: 'column',
    label: 'Canal do Inbox',
    titleColumn: 'name',
    summaryColumns: ['type', 'status'],
  },
  {
    domainKey: 'leadflow.inbox.connection-session',
    product: 'leadflow',
    table: 'inbox_channel_connection_sessions',
    scopeEncoding: 'column',
    label: 'Sessão de conexão de canal',
    titleColumn: null,
    // Never project the session payload: it carries provider credentials.
    summaryColumns: ['channel_type', 'status'],
  },
  {
    domainKey: 'leadflow.inbox.conversation',
    product: 'leadflow',
    table: 'inbox_conversations',
    scopeEncoding: 'column',
    label: 'Conversa',
    titleColumn: 'title',
    // `last_message_preview` is deliberately excluded — message content is
    // PII and the operator does not need it to identify the account.
    summaryColumns: ['status', 'last_message_at'],
    parentEvidence: {
      column: 'channel_id',
      table: 'inbox_channels',
      automatic: false,
    },
  },

  // ── LeadFlow CRM & operations (CC2F) ───────────────────────────────────
  {
    domainKey: 'leadflow.crm.pipeline',
    product: 'leadflow',
    table: 'crm_pipelines',
    scopeEncoding: 'column',
    label: 'Pipeline de CRM',
    titleColumn: 'name',
    summaryColumns: ['business_mode', 'is_default'],
    softDeleteColumn: 'deleted_at',
  },
  {
    domainKey: 'leadflow.crm.opportunity',
    product: 'leadflow',
    table: 'crm_opportunities',
    scopeEncoding: 'column',
    label: 'Oportunidade de CRM',
    titleColumn: 'title',
    summaryColumns: ['status'],
    softDeleteColumn: 'deleted_at',
    /**
     * The one genuinely automatic case in CC2G: `pipeline_id` is NOT NULL and
     * `crm_pipelines` is company-scoped, so a legacy opportunity whose
     * pipeline already belongs to a company is owned by that company as a
     * matter of schema, not inference.
     */
    parentEvidence: {
      column: 'pipeline_id',
      table: 'crm_pipelines',
      automatic: true,
    },
  },
  {
    domainKey: 'leadflow.crm.tag',
    product: 'leadflow',
    table: 'crm_tags',
    scopeEncoding: 'column',
    label: 'Tag de CRM',
    titleColumn: 'name',
    summaryColumns: ['kind'],
  },
  {
    domainKey: 'leadflow.agent',
    product: 'leadflow',
    table: 'leadflow_agents',
    scopeEncoding: 'implicit',
    label: 'Agente',
    titleColumn: 'name',
    summaryColumns: ['business_mode_key', 'status'],
    softDeleteColumn: 'deleted_at',
  },
  {
    domainKey: 'leadflow.automation',
    product: 'leadflow',
    table: 'leadflow_automations',
    scopeEncoding: 'implicit',
    label: 'Automação',
    titleColumn: 'name',
    // `leadflow_automations` has no `deleted_at`: archival is expressed
    // through `status`, so there is no soft-delete column to exclude.
    summaryColumns: ['status'],
  },
  {
    domainKey: 'leadflow.scheduled-item',
    product: 'leadflow',
    table: 'scheduled_items',
    scopeEncoding: 'column',
    label: 'Item de agenda',
    titleColumn: 'title',
    summaryColumns: ['status', 'start_at', 'due_at'],
    softDeleteColumn: 'deleted_at',
    parentEvidence: {
      column: 'source_opportunity_id',
      table: 'crm_opportunities',
      automatic: false,
    },
  },
  {
    domainKey: 'leadflow.analytics-view',
    product: 'leadflow',
    table: 'leadflow_analytics_views',
    scopeEncoding: 'implicit',
    label: 'View de Analytics',
    titleColumn: 'name',
    summaryColumns: ['report_type'],
  },
  {
    domainKey: 'leadflow.intelligence-recommendation',
    product: 'leadflow',
    table: 'leadflow_intelligence_recommendations',
    scopeEncoding: 'implicit',
    label: 'Recomendação de Intelligence',
    titleColumn: null,
    summaryColumns: ['business_mode_key', 'status'],
  },
] as const;

const DOMAINS_BY_KEY = new Map(
  COMPANY_LEGACY_DOMAINS.map((domain) => [domain.domainKey, domain]),
);

export function findCompanyLegacyDomain(
  domainKey: string,
): CompanyLegacyDomain | null {
  return DOMAINS_BY_KEY.get(domainKey) ?? null;
}
