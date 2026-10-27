import {
  ForbiddenException,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  ClientAreaBridgeRegistry,
  type ClientAreaScopedResource,
} from '../../common/client-area-bridge/client-area-bridge.registry';
import {
  isUuid,
  type ClientAreaContext,
  type ClientAreaModuleKey,
} from '../client-area/client-area.types';
import type { PermissionScopeRequest } from '../permissions/types/permission-context.types';
import {
  socialClientAreaRule,
  socialRuleModules,
  type SocialClientAreaRef,
} from './social-client-area.routes';

export const CLIENT_AREA_COST_ACTION_DISABLED =
  'client_area_cost_action_disabled';
export const SOCIAL_CLIENT_AREA_MODULES = [
  'social_planner',
  'social_creative_studio',
  'social_campaigns',
] as const satisfies readonly ClientAreaModuleKey[];
/** CA-AN1 — modules whose Social routes this adapter resolves. */
const RESOLVED_MODULES = [
  ...SOCIAL_CLIENT_AREA_MODULES,
  'analytics',
] as const satisfies readonly ClientAreaModuleKey[];

type Row = {
  id: string;
  client: string | null;
  company: string | null;
  creator: string | null;
  parent: string | null;
  /** CA-AN1 — private Owner dashboard: visible to that Owner only. */
  owner?: string | null;
};

/** `alias` carries tenant/workspace; `idAlias` is the addressed row (a child without its own scope columns). */
const scoped = (from: string, alias: string, select: string, idAlias = alias) =>
  `SELECT ${idAlias}.id, ${select} FROM ${from} WHERE ${alias}.tenant_id=$1 AND ${alias}.workspace_id=$2 AND ${idAlias}.id = ANY($3::uuid[])`;
const own = (alias: string, creator = 'created_by_id', parent = 'NULL') =>
  `${alias}.agency_client_id AS client, ${alias}.company_context_id AS company, ${alias}.${creator} AS creator, ${parent} AS parent`;
const PLAN_JOIN =
  'JOIN social_plans p ON p.id = c.plan_id AND p.tenant_id = c.tenant_id AND p.workspace_id = c.workspace_id AND p.deleted_at IS NULL';
const CONTENT_JOIN = (column: string) =>
  `JOIN social_content_items c ON c.id = ${column} AND c.deleted_at IS NULL ${PLAN_JOIN}`;
const CONNECTION_JOIN = (alias: string) =>
  `JOIN social_ad_account_connections ac ON ac.id = ${alias}.connection_id AND ac.tenant_id = ${alias}.tenant_id AND ac.workspace_id = ${alias}.workspace_id`;

/**
 * Every query proves tenant + workspace in SQL and returns the row's real
 * Agency Client and Company Context; `resolve` compares both with the forced
 * membership. Content-bound rows take the company of their plan, because
 * `social_content_items` itself carries only the Agency Client (CC2): a
 * sibling company of the same client must never satisfy the check.
 */
export const SOCIAL_CLIENT_AREA_SCOPE_SQL: Record<SocialClientAreaRef, string> =
  {
    brandKitAsset:
      scoped(
        'brand_kit_assets a JOIN brand_kits k ON k.id = a.brand_kit_id AND k.tenant_id = a.tenant_id AND k.workspace_id = a.workspace_id',
        'a',
        'a.agency_client_id AS client, k.company_context_id AS company, a.created_by_id AS creator, a.brand_kit_id AS parent',
      ) + ' AND a.deleted_at IS NULL',
    plan: `${scoped('social_plans p', 'p', own('p'))} AND p.deleted_at IS NULL`,
    content: `${scoped(`social_content_items c ${PLAN_JOIN}`, 'c', 'c.agency_client_id AS client, p.company_context_id AS company, c.created_by_id AS creator, c.plan_id AS parent')} AND c.deleted_at IS NULL`,
    revision: scoped(
      `social_content_revisions r ${CONTENT_JOIN('r.content_item_id')}`,
      'r',
      'r.agency_client_id AS client, p.company_context_id AS company, r.created_by_id AS creator, r.content_item_id AS parent',
    ),
    idea: scoped('social_content_ideas i', 'i', own('i')),
    campaign: scoped('social_campaign_instances k', 'k', own('k')),
    campaignTemplate: scoped('social_campaign_templates t', 't', own('t')),
    pillar: scoped('social_editorial_pillars e', 'e', own('e')),
    copyRun: scoped(
      'social_copy_generation_runs r LEFT JOIN social_content_items c ON c.id = r.content_item_id AND c.deleted_at IS NULL LEFT JOIN social_plans pc ON pc.id = c.plan_id LEFT JOIN social_plans pp ON pp.id = r.plan_id',
      'r',
      'r.agency_client_id AS client, COALESCE(pc.company_context_id, pp.company_context_id) AS company, r.requested_by_id AS creator, r.content_item_id AS parent',
    ),
    proposal: scoped(
      `social_copy_generation_proposals g ${CONTENT_JOIN('g.content_item_id')}`,
      'g',
      'g.agency_client_id AS client, p.company_context_id AS company, NULL AS creator, g.content_item_id AS parent',
    ),
    reference: scoped(
      'social_content_references f',
      'f',
      own('f', 'created_by_id', 'f.content_item_id'),
    ),
    destination: scoped(
      `social_content_destinations d ${CONTENT_JOIN('d.content_item_id')}`,
      'd',
      'd.agency_client_id AS client, p.company_context_id AS company, c.created_by_id AS creator, d.content_item_id AS parent',
    ),
    publication: `${scoped(
      'social_publications s JOIN social_organic_assets oa ON oa.id = s.asset_id LEFT JOIN social_content_items c ON c.id = s.content_item_id LEFT JOIN social_plans p ON p.id = c.plan_id',
      's',
      's.agency_client_id AS client, oa.company_context_id AS company, s.created_by_id AS creator, s.content_item_id AS parent',
    )} AND (s.content_item_id IS NULL OR p.company_context_id IS NOT DISTINCT FROM oa.company_context_id)`,
    media: `${scoped('media_assets m', 'm', own('m'))} AND m.deleted_at IS NULL`,
    organicAsset: scoped(
      'social_organic_assets o',
      'o',
      'o.agency_client_id AS client, o.company_context_id AS company, NULL AS creator, NULL AS parent',
    ),
    creativeAsset: scoped('social_creative_assets a', 'a', own('a')),
    creativeVersion: scoped(
      'social_creative_asset_versions v JOIN social_creative_assets a ON a.id = v.creative_asset_id',
      'a',
      'a.agency_client_id AS client, a.company_context_id AS company, v.created_by_id AS creator, v.creative_asset_id AS parent',
      'v',
    ),
    folder: scoped('social_creative_folders fo', 'fo', own('fo')),
    generation: scoped(
      'social_creative_generations gn',
      'gn',
      own('gn', 'requested_by_id'),
    ),
    generationOutput: scoped(
      'social_creative_generation_outputs go JOIN social_creative_generations gn ON gn.id = go.generation_id',
      'gn',
      'gn.agency_client_id AS client, gn.company_context_id AS company, gn.requested_by_id AS creator, go.generation_id AS parent',
      'go',
    ),
    videoGeneration: scoped(
      'social_creative_video_generations vg',
      'vg',
      own('vg', 'requested_by_id'),
    ),
    connection: `${scoped('social_ad_account_connections ac', 'ac', 'ac.agency_client_id AS client, ac.company_context_id AS company, NULL AS creator, NULL AS parent')} AND ac.credential_removed_at IS NULL`,
    adAction: scoped(
      `social_ad_governed_actions x ${CONNECTION_JOIN('x')}`,
      'x',
      'x.agency_client_id AS client, ac.company_context_id AS company, x.proposed_by_id AS creator, x.connection_id AS parent',
    ),
    alert: scoped(
      `social_campaign_alerts al ${CONNECTION_JOIN('al')}`,
      'al',
      'al.agency_client_id AS client, ac.company_context_id AS company, NULL AS creator, al.connection_id AS parent',
    ),
    analyticsDashboard: scoped(
      'social_analytics_dashboards ad',
      'ad',
      `${own('ad')}, ad.client_area_owner_user_id AS owner`,
    ),
    analyticsReport: scoped('social_analytics_reports ar', 'ar', own('ar')),
  };

/** Values of `field`, or of `items[].field` across an array of objects. */
function readIds(source: Record<string, unknown>, path: string): unknown[] {
  const [head, tail] = path.split('[].');
  const value = source[head];
  if (tail === undefined)
    return value === undefined || value === null
      ? []
      : Array.isArray(value)
        ? (value as unknown[])
        : [value];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [value];
  return (value as unknown[]).flatMap((item) =>
    item && typeof item === 'object'
      ? readIds(item as Record<string, unknown>, tail)
      : [item],
  );
}

/**
 * CA10 — the Social adapter of the Client Area scope registry (D-09), for
 * the three Social modules. It resolves only the audited templates of
 * `SOCIAL_CLIENT_AREA_ROUTES`; the shared evaluator then re-proves tenant,
 * workspace, Agency Client, Company Context and authorship.
 *
 * `null` (404) for anything unknown, malformed or outside the company. 403
 * only once scope matched the membership: a Manager-only action asked by an
 * Operator, or a cost action with the agency toggle off (D-13).
 */
@Injectable()
export class SocialClientAreaScopeService implements OnModuleInit {
  constructor(
    @InjectDataSource('agency') private readonly db: DataSource,
    private readonly registry: ClientAreaBridgeRegistry,
  ) {}

  onModuleInit() {
    for (const module of RESOLVED_MODULES)
      this.registry.registerScopeResolver(module, (context, key, request) =>
        this.resolve(module, context, key, request),
      );
  }

  async resolve(
    module: ClientAreaModuleKey,
    context: ClientAreaContext,
    _key: string,
    request: PermissionScopeRequest,
  ): Promise<ClientAreaScopedResource | null> {
    const rule = socialClientAreaRule(request.method, request.routePath);
    if (!rule || !socialRuleModules(rule).includes(module)) return null;
    const level = context.memberAccess?.[module]?.level ?? null;
    if (!level) return null;
    const body = request.body ?? {};
    if (typeof body !== 'object' || Array.isArray(body)) return null;
    const params = request.params ?? {};
    const query = request.query ?? {};

    // Collect every id the request names, by table, before any query runs.
    const wanted = new Map<SocialClientAreaRef, Set<string>>();
    const want = (ref: SocialClientAreaRef, values: unknown[]) => {
      for (const value of values) {
        if (!isUuid(value)) return false;
        const set = wanted.get(ref) ?? new Set<string>();
        set.add(value.toLowerCase());
        wanted.set(ref, set);
      }
      return true;
    };
    const subjectId = rule.subject ? params[rule.subject.param] : undefined;
    if (rule.subject && !want(rule.subject.ref, [subjectId])) return null;
    const nestedId = rule.nested ? params[rule.nested.param] : undefined;
    if (rule.nested && !want(rule.nested.ref, [nestedId])) return null;
    const batch = rule.batch ? readIds(body, rule.batch.field) : [];
    if (rule.batch && (!batch.length || !want(rule.batch.ref, batch)))
      return null;
    for (const [source, refs] of [
      [body, rule.body],
      [query, rule.query],
    ] as const)
      for (const [field, ref] of Object.entries(refs ?? {})) {
        const ids = readIds(source, field);
        // Guards see the raw query: `?ids=a,b` is still one value there
        // (CA-AN1, `publicationIds`); every part must be proven.
        const values =
          source === query
            ? ids.flatMap((id) =>
                typeof id === 'string' ? id.split(',').filter(Boolean) : [id],
              )
            : ids;
        if (!want(ref, values)) return null;
      }

    const found = new Map<string, Row>();
    for (const [ref, ids] of wanted) {
      const rows = await this.db.query<Row[]>(
        SOCIAL_CLIENT_AREA_SCOPE_SQL[ref],
        [context.tenantId, context.workspaceId, [...ids]],
      );
      for (const row of rows)
        if (
          row.client === context.agencyClientId &&
          row.company === context.companyContextId &&
          (!row.owner || row.owner === context.userId)
        )
          found.set(`${ref}:${String(row.id).toLowerCase()}`, row);
      for (const id of ids) if (!found.has(`${ref}:${id}`)) return null;
    }
    const row = (ref: SocialClientAreaRef, id: unknown) =>
      found.get(`${ref}:${String(id).toLowerCase()}`)!;

    const subject = rule.subject ? row(rule.subject.ref, subjectId) : null;
    const childOfSubject = (ref: SocialClientAreaRef, id: unknown) =>
      String(row(ref, id).parent).toLowerCase() === subject?.id.toLowerCase();
    if (rule.nested && !childOfSubject(rule.nested.ref, nestedId)) return null;
    if (
      rule.batch &&
      rule.subject &&
      batch.some((id) => !childOfSubject(rule.batch!.ref, id))
    )
      return null;

    // Scope matched the membership: only now may the answer be a 403.
    if (rule.manager && level !== 'manager')
      throw new ForbiddenException('Insufficient module level.');
    if (
      rule.cost &&
      !(rule.cost === 'ai'
        ? context.allowAiCostActions
        : context.allowMediaSpendActions)
    )
      throw new ForbiddenException({
        code: CLIENT_AREA_COST_ACTION_DISABLED,
        message: 'Cost actions are disabled.',
      });

    // Authorship: the addressed row's author; for a batch, the request is the
    // Operator's own only when every row is (one foreign row denies it all).
    let createdById: string | null = subject?.creator ?? context.userId;
    if (rule.batch && !rule.subject) {
      const foreign = batch
        .map((id) => row(rule.batch!.ref, id).creator)
        .find((creator) => creator !== context.userId);
      createdById = foreign === undefined ? context.userId : foreign;
    }
    if (
      rule.operatorOwn &&
      level === 'operator' &&
      createdById !== context.userId
    )
      return null;
    return {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      agencyClientId: context.agencyClientId,
      companyContextId: context.companyContextId,
      createdById,
    };
  }
}
