import type {
  SocialPlannerSettings,
  SocialPublishingCadence,
} from '../contracts';
import type { SocialPlanEntity } from '../entities';
import type { ResolvedCommemorativeDate } from './commemorative-dates.resolver';
import type { SocialBrandContext } from './social-brand-context.port';

/**
 * Bumped whenever this builder changes which inputs reach the prompt, and
 * recorded on every run (§8.5 asks for context version as provenance).
 */
export const SOCIAL_PLAN_CONTEXT_VERSION = 'planner-plan-context-v1';

export interface PlanGenerationContextInput {
  plan: SocialPlanEntity;
  settings: SocialPlannerSettings;
  cadence: SocialPublishingCadence;
  brand: SocialBrandContext;
  commemorativeDates: ResolvedCommemorativeDate[];
  commemorativeStoryOnly: boolean;
  itemCount: number;
}

/**
 * Turns Planner configuration and Brand Kit facts into the plain-text context
 * sent to the provider for plan generation.
 *
 * WHY A PURE FUNCTION IN ITS OWN FILE
 * -----------------------------------
 * Same reason as `buildCopyGenerationContext`: what reaches a paid provider is
 * a security property, not a formatting detail, and as a pure function it is
 * testable without a database, a provider or a Nest container.
 *
 * WHAT IS DELIBERATELY NOT SENT
 * -----------------------------
 *   - the scope triple, any uuid, and any created/updated-by id;
 *   - contact details: phone, e-mail, WhatsApp and the street address. The
 *     model plans a calendar; a phone number would only ever end up in a
 *     provider log. City, region and country DO go, because "where the business
 *     operates" changes what is seasonally relevant;
 *   - anything about publication state or connected accounts.
 */
export function buildPlanGenerationContext(
  input: PlanGenerationContextInput,
  maxChars: number,
): string {
  const { plan, settings, cadence, brand } = input;
  const lines: string[] = [];

  lines.push('== PLANEJAMENTO ==');
  lines.push(`Título: ${plan.title}`);
  lines.push(`Período: ${plan.periodStart} a ${plan.periodEnd}`);
  lines.push(`Quantidade de peças a gerar: ${input.itemCount}`);
  if (plan.primaryObjective)
    lines.push(`Objetivo principal: ${plan.primaryObjective}`);
  if (plan.strategyMode)
    lines.push(`Modo estratégico: ${strategyModeLabel(plan.strategyMode)}`);
  if (plan.summary) lines.push(`Instruções do planejamento: ${plan.summary}`);

  const brandLines = brandSection(brand);
  if (brandLines.length > 0) {
    lines.push('', '== MARCA ==');
    lines.push(...brandLines);
  }

  lines.push('', '== TAXONOMIA PERMITIDA ==');
  lines.push(
    'Use exatamente estas chaves. O rótulo entre parênteses é só para você ' +
      'entender o significado; devolva sempre a chave.',
  );
  lines.push(`Etapas do funil: ${funnelStageList()}`);
  lines.push(`Tipos de conteúdo: ${catalogList(settings.contentTypes)}`);
  lines.push(`Objetivos: ${catalogList(settings.objectives)}`);
  lines.push(`Formatos criativos: ${catalogList(settings.creativeFormats)}`);

  const channels = enabledChannels(cadence);
  if (channels.length > 0) lines.push(`Canais ativos: ${channels.join(', ')}`);

  lines.push('', '== DISTRIBUIÇÃO ALVO DO FUNIL (% do total) ==');
  lines.push(
    `Descoberta ${settings.funnelDistribution.discovery}% | ` +
      `Reconhecimento ${settings.funnelDistribution.recognition}% | ` +
      `Consideração ${settings.funnelDistribution.consideration}% | ` +
      `Decisão ${settings.funnelDistribution.decision}%`,
  );

  const cadenceLines = cadenceSection(cadence);
  if (cadenceLines.length > 0) {
    lines.push('', '== CADÊNCIA DE PUBLICAÇÃO ==');
    lines.push(`Fuso horário: ${cadence.timezone}`);
    lines.push(...cadenceLines);
  }

  if (input.commemorativeDates.length > 0) {
    lines.push('', '== DATAS COMEMORATIVAS SELECIONADAS ==');
    lines.push(
      'Crie uma peça para cada data abaixo, exatamente na data indicada, ' +
        'marcando "commemorativeDateKey" com a chave correspondente.',
    );
    for (const date of input.commemorativeDates)
      lines.push(
        `- ${date.date} — ${date.label} (chave: ${date.key}${
          date.significance === 'national' ? ', data nacional' : ''
        })`,
      );

    if (input.commemorativeStoryOnly)
      lines.push(
        'IMPORTANTE: as peças de datas comemorativas devem ser apenas Story — ' +
          'use o formato de Story e o placement "story" nelas, e não crie ' +
          'peças de feed para essas datas.',
      );
  }

  if (settings.hookLibrary.length > 0)
    lines.push(
      '',
      `Referências de estilo da agência: ${settings.hookLibrary
        .slice(0, 10)
        .join(' | ')}`,
    );

  /**
   * Truncation is on a line boundary, not mid-sentence: a prompt that ends
   * halfway through "não crie" inverts its own meaning.
   */
  return truncateByLine(lines, maxChars);
}

/**
 * The allowed vocabularies, as the provider's JSON schema enums.
 *
 * Derived from the same settings the context describes, so the prompt and the
 * schema can never disagree about what a valid key is.
 */
export function planGenerationVocabulary(
  settings: SocialPlannerSettings,
  cadence: SocialPublishingCadence,
  commemorativeDates: ResolvedCommemorativeDate[],
): {
  channels: string[];
  placements: string[];
  creativeFormats: string[];
  funnelStages: string[];
  contentTypes: string[];
  objectives: string[];
  commemorativeDateKeys: string[];
} {
  return {
    channels: enabledChannels(cadence),
    placements: SOCIAL_PLACEMENTS,
    creativeFormats: enabledKeys(settings.creativeFormats),
    funnelStages: FUNNEL_STAGES,
    contentTypes: enabledKeys(settings.contentTypes),
    objectives: enabledKeys(settings.objectives),
    commemorativeDateKeys: commemorativeDates.map((date) => date.key),
  };
}

/**
 * The canonical editorial placements E4 normalized to. Hardcoded rather than
 * read from settings because they are a property of the channels themselves,
 * not an agency preference — no settings screen offers them.
 */
const SOCIAL_PLACEMENTS = ['feed', 'story', 'reel', 'short', 'post'];

const FUNNEL_STAGES = ['discovery', 'recognition', 'consideration', 'decision'];

const FUNNEL_STAGE_LABELS: Record<string, string> = {
  discovery: 'Descoberta',
  recognition: 'Reconhecimento',
  consideration: 'Consideração',
  decision: 'Decisão',
};

function funnelStageList(): string {
  return FUNNEL_STAGES.map(
    (key) => `${key} (${FUNNEL_STAGE_LABELS[key] ?? key})`,
  ).join(', ');
}

function catalogList(
  catalog: Array<{ key: string; label: string; enabled: boolean }>,
): string {
  const enabled = catalog.filter((entry) => entry.enabled);
  return enabled.map((entry) => `${entry.key} (${entry.label})`).join(', ');
}

function enabledKeys(
  catalog: Array<{ key: string; label: string; enabled: boolean }>,
): string[] {
  return catalog.filter((entry) => entry.enabled).map((entry) => entry.key);
}

function enabledChannels(cadence: SocialPublishingCadence): string[] {
  return cadence.channels
    .filter((channel) => channel.enabled)
    .map((channel) => channel.channel);
}

function cadenceSection(cadence: SocialPublishingCadence): string[] {
  const lines: string[] = [];

  for (const channel of cadence.channels) {
    if (!channel.enabled) continue;

    const slots = channel.slots
      .map(
        (slot) =>
          `${WEEKDAY_LABELS[slot.dayOfWeek] ?? slot.dayOfWeek} ${slot.time}`,
      )
      .join(', ');

    const frequency =
      channel.frequencyPerMonth === null
        ? 'volume do planejamento'
        : `${channel.frequencyPerMonth} por mês`;

    lines.push(
      `- ${channel.channel}: ${frequency}${slots ? ` | horários: ${slots}` : ''}`,
    );
  }

  return lines;
}

const WEEKDAY_LABELS: Record<number, string> = {
  0: 'Dom',
  1: 'Seg',
  2: 'Ter',
  3: 'Qua',
  4: 'Qui',
  5: 'Sex',
  6: 'Sáb',
};

/**
 * "Always-on" was renamed to "Posts para Redes Sociais" in the UI. The stored
 * key stays `always_on` — renaming a persisted value would strand every plan
 * already written — so the label is resolved here, where the prompt is built.
 */
function strategyModeLabel(mode: string): string {
  switch (mode) {
    case 'always_on':
      return 'Posts para Redes Sociais';
    case 'campaign':
      return 'Campanha';
    case 'seasonal':
      return 'Sazonal';
    default:
      return mode;
  }
}

function brandSection(brand: SocialBrandContext): string[] {
  const lines: string[] = [];

  const push = (label: string, value: string | null) => {
    if (value) lines.push(`${label}: ${value}`);
  };

  push('Nome público', brand.publicName);
  push('Razão social', brand.legalName);
  push('Resumo do negócio', brand.summary);
  push('Proposta de valor', brand.valueProposition);
  push('Diferenciais', brand.differentiators);
  push('Público-alvo', brand.targetAudience);
  push('Regiões atendidas', brand.regionsServed);
  push('Serviços prioritários', brand.mainOffers);
  push('CTA preferido', brand.preferredCta);
  push('Objetivo de conversão', brand.conversionGoal);
  push('Políticas', brand.policies);

  const location = [brand.city, brand.stateRegion, brand.country]
    .filter((value): value is string => Boolean(value))
    .join(' / ');
  if (location) lines.push(`Localização: ${location}`);

  push('Segmento (business mode)', brand.businessMode);

  return lines;
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
