import type { SocialPlannerSettings } from '../contracts';
import type {
  SocialContentDestinationEntity,
  SocialContentItemEntity,
  SocialCopyGenerationField,
  SocialPlanEntity,
} from '../entities';

/**
 * Bumped whenever this builder changes which editorial inputs reach the prompt,
 * and recorded on every run (§8.5 asks for context version as provenance). An
 * old run's output stays explainable because the row says which recipe produced
 * it.
 */
export const SOCIAL_COPY_CONTEXT_VERSION = 'planner-context-v1';

export interface CopyGenerationContextInput {
  plan: SocialPlanEntity;
  item: SocialContentItemEntity;
  destinations: SocialContentDestinationEntity[];
  settings: SocialPlannerSettings;
  campaignTitle: string | null;
  pillarName: string | null;
}

/**
 * Turns Planner rows into the plain-text editorial context sent to the provider.
 *
 * WHY A PURE FUNCTION IN ITS OWN FILE
 * ----------------------------------
 * What reaches a paid provider — and therefore what could leak through one — is
 * a security property, not a formatting detail. As a pure function it is
 * testable without a database, a provider or a Nest container, so "does client
 * data X ever reach the prompt" is answered by a spec rather than by reading a
 * worker.
 *
 * WHAT IS DELIBERATELY NOT SENT
 * -----------------------------
 *   - the scope triple, any uuid, and any created/updated-by id. A model does
 *     not write better copy knowing a tenant uuid, and ids in prompts are how
 *     identifiers end up in provider logs;
 *   - media, storage paths and connected-account identifiers. Creative files
 *     stay private per §3 of the handoff, and nothing here needs them;
 *   - publication state. This is editorial generation; execution state is a
 *     different domain and was kept separate all through this campaign.
 *
 * Only the editorial fields an agency copywriter would actually be briefed with
 * cross into the prompt.
 */
export function buildCopyGenerationContext(
  input: CopyGenerationContextInput,
  maxChars: number,
): string {
  const { plan, item, destinations, settings } = input;
  const lines: string[] = [];

  lines.push(`Planejamento: ${plan.title}`);
  lines.push(
    `Período do planejamento: ${plan.periodStart} a ${plan.periodEnd}`,
  );
  if (plan.primaryObjective)
    lines.push(`Objetivo do planejamento: ${plan.primaryObjective}`);
  if (plan.summary) lines.push(`Resumo do planejamento: ${plan.summary}`);

  lines.push(`Título da peça: ${item.title}`);
  if (item.theme) lines.push(`Tema: ${item.theme}`);
  if (item.brief) lines.push(`Brief: ${item.brief}`);
  if (item.keyMessage) lines.push(`Mensagem-chave: ${item.keyMessage}`);
  if (item.plannedDate) lines.push(`Data planejada: ${item.plannedDate}`);

  /**
   * Funnel stages have no label catalog in settings — only a target
   * distribution — so the stored key is the only name there is. Sent verbatim
   * rather than prettified, because inventing a label here would disagree with
   * whatever the UI shows.
   */
  if (item.funnelStage) lines.push(`Etapa do funil: ${item.funnelStage}`);

  const contentType = labelFor(settings.contentTypes, item.contentType);
  if (item.contentType)
    lines.push(`Tipo de conteúdo: ${contentType ?? item.contentType}`);

  const objective = labelFor(settings.objectives, item.objective);
  if (item.objective)
    lines.push(`Objetivo da peça: ${objective ?? item.objective}`);

  if (item.creativeFormat)
    lines.push(`Formato criativo: ${item.creativeFormat}`);

  if (input.campaignTitle) lines.push(`Campanha: ${input.campaignTitle}`);
  if (input.pillarName) lines.push(`Pilar editorial: ${input.pillarName}`);

  if (destinations.length > 0)
    lines.push(
      `Destinos: ${destinations
        .map((destination) => `${destination.channel}/${destination.placement}`)
        .join(', ')}`,
    );

  /**
   * Settings are the agency's editorial standards, which is exactly the kind of
   * grounding that keeps generated copy on-brand. Only the active catalog
   * entries and the declared defaults go in.
   */
  const mandatory = settings.hashtagDefaults.mandatory;
  if (mandatory.length > 0)
    lines.push(`Hashtags obrigatórias: ${mandatory.join(' ')}`);

  lines.push(
    `Quantidade sugerida de hashtags: ${settings.hashtagDefaults.suggestedCount}`,
  );

  const ctas = item.objective
    ? settings.ctaDefaults[item.objective]
    : undefined;
  if (ctas && ctas.length > 0)
    lines.push(`CTAs preferidos para este objetivo: ${ctas.join(' | ')}`);

  if (settings.hookLibrary.length > 0)
    lines.push(
      `Biblioteca de hooks da agência (referência de estilo): ${settings.hookLibrary
        .slice(0, 10)
        .join(' | ')}`,
    );

  if (
    settings.firstCommentDefaults.enabled &&
    settings.firstCommentDefaults.template
  )
    lines.push(
      `Modelo de primeiro comentário: ${settings.firstCommentDefaults.template}`,
    );

  /**
   * Truncation is on a line boundary, not mid-sentence: a prompt that ends
   * halfway through "não mencione" inverts its own meaning.
   */
  return truncateByLine(lines, maxChars);
}

/**
 * Which fields a generation should cover when the caller did not say.
 *
 * The editorial rules live here rather than in the client because E5 already
 * established them for the content page (a script only belongs to video
 * formats, a Story has no caption) and two copies of that logic would drift.
 * A caller that asks explicitly still gets exactly what it asked for.
 */
export function defaultFieldsFor(
  item: SocialContentItemEntity,
  destinations: SocialContentDestinationEntity[],
  settings: SocialPlannerSettings,
): SocialCopyGenerationField[] {
  const fields: SocialCopyGenerationField[] = ['copy'];

  const placements = destinations.map((destination) =>
    destination.placement.toLowerCase(),
  );
  const hasDestinations = destinations.length > 0;
  const everyDestinationIsStory =
    hasDestinations && placements.every((placement) => placement === 'story');

  // Story carries no caption. Asking for one when every destination is a Story
  // would stage a proposal the content page deliberately disables.
  if (!everyDestinationIsStory) fields.push('caption');

  if (isVideoFormat(item.creativeFormat, placements)) fields.push('script');

  fields.push('cta', 'hashtags');

  if (settings.firstCommentDefaults.enabled && !everyDestinationIsStory)
    fields.push('firstComment');

  return fields;
}

/**
 * Video vocabulary is checked against the canonical singular values E4
 * normalized to (`reel`, `story`), with the plural legacy spellings accepted
 * because older rows were written before that normalization and must not
 * silently lose their script.
 */
function isVideoFormat(
  creativeFormat: string | null,
  placements: string[],
): boolean {
  const candidates = [creativeFormat ?? '', ...placements].map((value) =>
    value.toLowerCase(),
  );

  return candidates.some((value) =>
    ['reel', 'reels', 'video', 'vídeo', 'short', 'shorts', 'tiktok'].includes(
      value,
    ),
  );
}

function labelFor(
  catalog: Array<{ key: string; label: string; enabled: boolean }>,
  key: string | null,
): string | null {
  if (!key) return null;
  const entry = catalog.find((candidate) => candidate.key === key);
  return entry ? entry.label : null;
}

function truncateByLine(lines: string[], maxChars: number): string {
  const kept: string[] = [];
  let total = 0;

  for (const line of lines) {
    const cost = line.length + 1;
    if (total + cost > maxChars) break;
    kept.push(line);
    total += cost;
  }

  return kept.join('\n');
}
