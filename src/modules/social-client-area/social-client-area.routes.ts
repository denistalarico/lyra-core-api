import type { ClientAreaModuleKey } from '../client-area/client-area.types';

/**
 * CA10 — every Social route the Client Area may reach through the Surface
 * Bridge, keyed by `METHOD path-template` (global `/api` prefix removed).
 *
 * This table is the adapter's whole vocabulary: a template that is not here
 * never resolves, so the evaluator answers 404 even if a controller method
 * were opted in by mistake (`social-client-area.routes.spec.ts` keeps the
 * table and the `@ClientAreaExposed` decorators identical).
 *
 * - `subject`: the row the route addresses; its company proves scope and its
 *   author is the authorship compared for Operator "own" grants.
 * - `nested`: a second path id that must belong to the subject (revision of
 *   this content, reference of this content…).
 * - `body`/`query`: ids the request names; each must exist in the company.
 *   `items[].field` walks an array of objects. Multipart bodies are parsed
 *   after the guards, so their ids are proven by the company-scoped service.
 * - `manager`: §3.3 Manager-only actions whose Agency key is shared with
 *   ordinary Operator writes (403 for Operator).
 * - `cost`: D-13. Without the company toggle the route is 403
 *   `client_area_cost_action_disabled`, even for Manager/Owner.
 * - `operatorOwn`: an Operator may act on an existing row only if they
 *   created it, on routes whose Agency key is a create key.
 *
 * Deliberately absent (fail-closed): Planner/Studio deletes and archive of
 * assets (`@DangerousAction` / dangerous keys, D-CA10-BE-1), send-for-approval
 * (the client reviews, it does not submit), Production mutations and costs
 * (they call Agency `can()`, RK-3), ad deletion/boost, ad action and monitor
 * policies, boost templates writes, publication external deletion and every
 * Social settings route outside the company Planner settings/cadence.
 */
export type SocialClientAreaRef =
  | 'plan'
  | 'content'
  | 'revision'
  | 'idea'
  | 'campaign'
  | 'campaignTemplate'
  | 'pillar'
  | 'copyRun'
  | 'proposal'
  | 'reference'
  | 'destination'
  | 'publication'
  | 'media'
  | 'organicAsset'
  | 'creativeAsset'
  | 'creativeVersion'
  | 'folder'
  | 'generation'
  | 'generationOutput'
  | 'videoGeneration'
  | 'connection'
  | 'adAction'
  | 'alert';

export type SocialClientAreaRule = {
  module: ClientAreaModuleKey;
  subject?: { ref: SocialClientAreaRef; param: string };
  nested?: { ref: SocialClientAreaRef; param: string };
  body?: Record<string, SocialClientAreaRef>;
  query?: Record<string, SocialClientAreaRef>;
  batch?: { field: string; ref: SocialClientAreaRef };
  manager?: boolean;
  cost?: 'ai' | 'media';
  operatorOwn?: boolean;
};

const P = '/social/planner';
const PUB = '/social/publishing/publications';
const MEDIA = '/social/publishing/media';
const C = '/social/creative-studio';
const G = `${C}/generations`;
const V = `${C}/video-generations`;
const M = '/social/campaigns/meta';

const planner = (rule: Omit<SocialClientAreaRule, 'module'> = {}) => ({
  module: 'social_planner' as const,
  ...rule,
});
const studio = (rule: Omit<SocialClientAreaRule, 'module'> = {}) => ({
  module: 'social_creative_studio' as const,
  ...rule,
});
const campaigns = (rule: Omit<SocialClientAreaRule, 'module'> = {}) => ({
  module: 'social_campaigns' as const,
  ...rule,
});
const plan = { ref: 'plan', param: 'planId' } as const;
const content = { ref: 'content', param: 'contentId' } as const;
const contentRefs = {
  campaignInstanceId: 'campaign',
  editorialPillarId: 'pillar',
} as const;
const ideaRefs = {
  campaignInstanceId: 'campaign',
  pillarId: 'pillar',
} as const;
const asset = { ref: 'creativeAsset', param: 'id' } as const;
const output = { ref: 'generationOutput', param: 'outputId' } as const;
const video = { ref: 'videoGeneration', param: 'generationId' } as const;
const promote = { folderId: 'folder', contentItemId: 'content' } as const;
const promoteAsVersion = {
  assetId: 'creativeAsset',
  revisesVersionId: 'creativeVersion',
} as const;
const connection = { connectionId: 'connection' } as const;
const adAction = { ref: 'adAction', param: 'actionId' } as const;

export const SOCIAL_CLIENT_AREA_ROUTES: Readonly<
  Record<string, SocialClientAreaRule>
> = {
  // ------------------------------------------------------------- Planner
  [`GET ${P}/plans`]: planner(),
  [`POST ${P}/plans`]: planner({ manager: true }),
  [`GET ${P}/plans/:planId`]: planner({ subject: plan }),
  [`PATCH ${P}/plans/:planId`]: planner({ subject: plan }),
  [`POST ${P}/plans/:planId/archive`]: planner({ subject: plan }),
  [`GET ${P}/plans/:planId/content`]: planner({ subject: plan }),
  [`POST ${P}/plans/:planId/content`]: planner({
    subject: plan,
    body: contentRefs,
  }),
  [`GET ${P}/plans/:planId/content/export`]: planner({ subject: plan }),
  [`GET ${P}/plans/:planId/pillar-coverage`]: planner({ subject: plan }),
  [`GET ${P}/content/:contentId`]: planner({ subject: content }),
  [`PATCH ${P}/content/:contentId`]: planner({
    subject: content,
    body: contentRefs,
  }),
  [`PUT ${P}/content/:contentId/destinations`]: planner({ subject: content }),
  [`POST ${P}/content/:contentId/duplicate`]: planner({ subject: content }),
  [`POST ${P}/content/:contentId/archive`]: planner({ subject: content }),
  [`POST ${P}/content/:contentId/restore`]: planner({ subject: content }),
  [`POST ${P}/content/batch/archive`]: planner({
    batch: { field: 'contentIds', ref: 'content' },
  }),
  [`POST ${P}/content/batch/restore`]: planner({
    batch: { field: 'contentIds', ref: 'content' },
  }),
  [`GET ${P}/content/:contentId/revisions`]: planner({ subject: content }),
  [`POST ${P}/content/:contentId/revisions`]: planner({
    subject: content,
    body: { generationRunId: 'copyRun' },
  }),
  [`POST ${P}/content/:contentId/revisions/:revisionId/restore`]: planner({
    subject: content,
    nested: { ref: 'revision', param: 'revisionId' },
  }),
  [`GET ${P}/generation-availability`]: planner(),
  [`GET ${P}/content/:contentId/copy-generation`]: planner({
    subject: content,
  }),
  [`POST ${P}/content/:contentId/copy-generation`]: planner({
    subject: content,
    manager: true,
    cost: 'ai',
  }),
  [`POST ${P}/content/:contentId/copy-generation/accept`]: planner({
    subject: content,
    batch: { field: 'proposalIds', ref: 'proposal' },
  }),
  [`POST ${P}/content/:contentId/copy-generation/reject`]: planner({
    subject: content,
    batch: { field: 'proposalIds', ref: 'proposal' },
  }),
  [`GET ${P}/copy-generation/:runId`]: planner({
    subject: { ref: 'copyRun', param: 'runId' },
  }),
  [`POST ${P}/copy-generation/:runId/cancel`]: planner({
    subject: { ref: 'copyRun', param: 'runId' },
    manager: true,
  }),
  [`POST ${P}/content/batch/copy-generation`]: planner({
    batch: { field: 'contentIds', ref: 'content' },
    manager: true,
    cost: 'ai',
  }),
  [`POST ${P}/plans/:planId/copy-generation`]: planner({
    subject: plan,
    manager: true,
    cost: 'ai',
  }),
  [`GET ${P}/commemorative-dates`]: planner(),
  [`POST ${P}/plans/:planId/generate`]: planner({
    subject: plan,
    manager: true,
    cost: 'ai',
  }),
  [`GET ${P}/campaign-templates`]: planner(),
  [`POST ${P}/campaign-templates`]: planner({ manager: true }),
  [`PATCH ${P}/campaign-templates/:templateId`]: planner({
    subject: { ref: 'campaignTemplate', param: 'templateId' },
    manager: true,
  }),
  [`GET ${P}/campaigns`]: planner(),
  [`POST ${P}/campaigns`]: planner({
    manager: true,
    body: { templateId: 'campaignTemplate' },
  }),
  [`PATCH ${P}/campaigns/:campaignId`]: planner({
    subject: { ref: 'campaign', param: 'campaignId' },
    manager: true,
    body: { templateId: 'campaignTemplate' },
  }),
  [`GET ${P}/pillars`]: planner(),
  [`POST ${P}/pillars`]: planner({ manager: true }),
  [`PATCH ${P}/pillars/:pillarId`]: planner({
    subject: { ref: 'pillar', param: 'pillarId' },
    manager: true,
  }),
  [`GET ${P}/ideas`]: planner(),
  [`POST ${P}/ideas`]: planner({ body: ideaRefs }),
  [`PATCH ${P}/ideas/:ideaId`]: planner({
    subject: { ref: 'idea', param: 'ideaId' },
    body: ideaRefs,
  }),
  [`POST ${P}/ideas/:ideaId/discard`]: planner({
    subject: { ref: 'idea', param: 'ideaId' },
  }),
  [`POST ${P}/ideas/:ideaId/convert`]: planner({
    subject: { ref: 'idea', param: 'ideaId' },
    body: { planId: 'plan' },
    operatorOwn: true,
  }),
  [`GET ${P}/settings`]: planner(),
  [`PATCH ${P}/settings`]: planner({ manager: true }),
  [`GET ${P}/cadence`]: planner(),
  [`PATCH ${P}/cadence`]: planner({ manager: true }),
  // Planner references (social-content-reference.controller)
  [`GET ${P}/content/:contentId/references`]: planner({ subject: content }),
  [`POST ${P}/content/:contentId/references`]: planner({
    subject: content,
    body: { mediaAssetId: 'media' },
  }),
  [`PUT ${P}/content/:contentId/references/order`]: planner({
    subject: content,
    batch: { field: 'referenceIds', ref: 'reference' },
  }),
  [`PATCH ${P}/content/:contentId/references/:referenceId`]: planner({
    subject: content,
    nested: { ref: 'reference', param: 'referenceId' },
  }),
  [`DELETE ${P}/content/:contentId/references/:referenceId`]: planner({
    subject: content,
    nested: { ref: 'reference', param: 'referenceId' },
  }),
  // Destination creatives (social-organic destination-creative.controller)
  [`GET ${P}/content/:contentId/creatives`]: planner({ subject: content }),
  [`PUT ${P}/destinations/:destinationId/creative`]: planner({
    subject: { ref: 'destination', param: 'destinationId' },
    body: { mediaAssetId: 'media', organicAssetId: 'organicAsset' },
  }),
  [`PUT ${P}/destinations/:destinationId/creatives`]: planner({
    subject: { ref: 'destination', param: 'destinationId' },
    body: { organicAssetId: 'organicAsset', 'items[].mediaAssetId': 'media' },
  }),
  [`DELETE ${P}/destinations/:destinationId/creative`]: planner({
    subject: { ref: 'destination', param: 'destinationId' },
  }),
  // Publications: §3.3 "agendar publicação" is Manager (keys absent below it).
  [`GET ${PUB}/capabilities`]: planner(),
  [`GET ${PUB}/targets`]: planner(),
  [`GET ${PUB}`]: planner({ query: { contentItemId: 'content' } }),
  [`GET ${PUB}/:publicationId`]: planner({
    subject: { ref: 'publication', param: 'publicationId' },
  }),
  [`POST ${PUB}`]: planner({
    manager: true,
    body: {
      contentItemId: 'content',
      destinationId: 'destination',
      assetId: 'organicAsset',
      mediaAssetId: 'media',
      mediaAssetIds: 'media',
    },
  }),
  [`POST ${PUB}/:publicationId/publish-now`]: planner({
    subject: { ref: 'publication', param: 'publicationId' },
    manager: true,
  }),
  [`PATCH ${PUB}/:publicationId/schedule`]: planner({
    subject: { ref: 'publication', param: 'publicationId' },
    manager: true,
  }),
  [`POST ${PUB}/:publicationId/cancel`]: planner({
    subject: { ref: 'publication', param: 'publicationId' },
    manager: true,
  }),
  [`POST ${PUB}/:publicationId/retry`]: planner({
    subject: { ref: 'publication', param: 'publicationId' },
    manager: true,
  }),
  // Publishing media (common/media-assets)
  [`GET ${MEDIA}`]: planner(),
  [`POST ${MEDIA}`]: planner(),
  [`GET ${MEDIA}/:mediaAssetId/content`]: planner({
    subject: { ref: 'media', param: 'mediaAssetId' },
  }),

  // ------------------------------------------------------ Creative Studio
  [`GET ${C}/brand-context`]: studio(),
  [`GET ${C}/assets`]: studio({
    query: { folderId: 'folder', contentItemId: 'content' },
  }),
  [`POST ${C}/assets`]: studio(),
  [`GET ${C}/assets/:id`]: studio({ subject: asset }),
  [`PATCH ${C}/assets/:id`]: studio({
    subject: asset,
    body: { folderId: 'folder' },
  }),
  [`GET ${C}/assets/:id/content`]: studio({
    subject: asset,
    query: { versionId: 'creativeVersion' },
  }),
  [`GET ${C}/assets/:id/thumbnail`]: studio({
    subject: asset,
    query: { versionId: 'creativeVersion' },
  }),
  [`GET ${C}/assets/:id/versions`]: studio({ subject: asset }),
  [`POST ${C}/assets/:id/versions`]: studio({ subject: asset }),
  [`GET ${C}/folders`]: studio(),
  [`POST ${C}/folders`]: studio({ body: { parentId: 'folder' } }),
  [`PATCH ${C}/folders/:id`]: studio({
    subject: { ref: 'folder', param: 'id' },
  }),
  [`GET ${C}/production/:contentItemId`]: studio({
    subject: { ref: 'content', param: 'contentItemId' },
  }),
  [`POST ${G}/images`]: studio({
    manager: true,
    cost: 'ai',
    body: { contentItemId: 'content' },
  }),
  [`POST ${G}/:generationId/regenerate`]: studio({
    subject: { ref: 'generation', param: 'generationId' },
    manager: true,
    cost: 'ai',
  }),
  [`POST ${G}/outputs/:outputId/vary`]: studio({
    subject: output,
    manager: true,
    cost: 'ai',
  }),
  [`GET ${G}/:generationId`]: studio({
    subject: { ref: 'generation', param: 'generationId' },
  }),
  [`GET ${G}/outputs/:outputId/content`]: studio({ subject: output }),
  [`POST ${G}/outputs/:outputId/promote`]: studio({
    subject: output,
    manager: true,
    body: promote,
  }),
  [`POST ${G}/outputs/:outputId/promote-as-version`]: studio({
    subject: output,
    manager: true,
    body: promoteAsVersion,
  }),
  [`POST ${C}/assets/:assetId/versions/:versionId/vary`]: studio({
    subject: { ref: 'creativeAsset', param: 'assetId' },
    nested: { ref: 'creativeVersion', param: 'versionId' },
    manager: true,
    cost: 'ai',
  }),
  [`POST ${V}`]: studio({
    manager: true,
    cost: 'ai',
    body: { contentItemId: 'content' },
  }),
  [`GET ${V}/:generationId`]: studio({ subject: video }),
  [`GET ${V}/:generationId/content`]: studio({ subject: video }),
  [`GET ${V}/:generationId/poster`]: studio({ subject: video }),
  [`POST ${V}/:generationId/promote`]: studio({
    subject: video,
    manager: true,
    body: promote,
  }),
  [`POST ${V}/:generationId/promote-as-version`]: studio({
    subject: video,
    manager: true,
    body: promoteAsVersion,
  }),
  [`GET ${C}/video-avatars`]: studio(),
  [`GET ${C}/video-avatars/:avatarId/preview`]: studio(),

  // ------------------------------------------------------------ Campaigns
  [`GET ${M}/actions/availability`]: campaigns(),
  [`GET ${M}/actions/policy`]: campaigns({ query: connection }),
  [`GET ${M}/actions/history`]: campaigns({ query: connection }),
  [`POST ${M}/actions/status/preflight`]: campaigns({
    manager: true,
    cost: 'media',
    body: connection,
  }),
  [`POST ${M}/actions/status/:actionId/confirm`]: campaigns({
    subject: adAction,
    manager: true,
    cost: 'media',
  }),
  [`POST ${M}/actions/budget/preflight`]: campaigns({
    manager: true,
    cost: 'media',
    body: connection,
  }),
  [`POST ${M}/actions/budget/:actionId/confirm`]: campaigns({
    subject: adAction,
    manager: true,
    cost: 'media',
  }),
  [`POST ${M}/actions/schedule/preflight`]: campaigns({
    manager: true,
    cost: 'media',
    body: connection,
  }),
  [`POST ${M}/actions/schedule/:actionId/confirm`]: campaigns({
    subject: adAction,
    manager: true,
    cost: 'media',
  }),
  [`GET ${M}/recommendations/availability`]: campaigns(),
  [`GET ${M}/recommendations`]: campaigns({ query: connection }),
  [`POST ${M}/recommendations/generate`]: campaigns({
    manager: true,
    cost: 'ai',
    body: connection,
  }),
  [`GET ${M}/monitor`]: campaigns({ query: connection }),
  [`POST ${M}/monitor/evaluate`]: campaigns({
    manager: true,
    body: connection,
  }),
  [`PATCH ${M}/alerts/:alertId/acknowledge`]: campaigns({
    subject: { ref: 'alert', param: 'alertId' },
    manager: true,
  }),
  [`GET ${M}/hierarchy`]: campaigns({ query: connection }),
  ['GET /social/campaigns/boost-templates']: campaigns(),
  // Read-only analytics the Campaigns page needs (social-integrations,
  // decorator-only opt-in authorized by the user, 2026-10-19).
  ['GET /social/analytics/connections']: campaigns(),
  ['GET /social/analytics/timeseries']: campaigns({ query: connection }),
};

export const socialClientRoutePath = (path: string) =>
  path.startsWith('/api/') ? path.slice(4) : path;

export function socialClientAreaRule(
  method: string | undefined,
  routePath: string | null | undefined,
): SocialClientAreaRule | undefined {
  const verb = method === 'HEAD' ? 'GET' : method;
  return SOCIAL_CLIENT_AREA_ROUTES[
    `${verb} ${socialClientRoutePath(routePath ?? '')}`
  ];
}
