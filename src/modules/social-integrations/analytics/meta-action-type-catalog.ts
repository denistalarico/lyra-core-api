/**
 * Every action type Meta reports, presented as a ranked table.
 *
 * ## What this answers that the conversion catalog does not
 *
 * `meta-conversion-catalog.ts` answers "how did the shop do" — a fixed list of
 * nineteen commerce events, each read by an ordered alias rule, each absent on
 * an account with no pixel. This answers a different question: "what did people
 * actually do after seeing the ads", over *whatever* the account reports,
 * including types nobody has catalogued.
 *
 * That difference drives every decision below. The conversion catalog is a
 * closed list and can afford to be; this one must render a type it has never
 * heard of, because the whole point is to show what is there. So an unknown
 * type is labelled by its own name and shown, never dropped.
 *
 * ## The overlap problem, which is the reason this file is not a `GROUP BY`
 *
 * Measured on the production account, the raw ranking opens like this:
 *
 * | type | total |
 * |---|---|
 * | `page_engagement` | 1036 |
 * | `post_engagement` | 1036 |
 * | `video_view` | 962 |
 * | `link_click` | 50 |
 *
 * The first two are the same 1 036 events under two names, and further down
 * `lead`, `onsite_conversion.lead`, `onsite_conversion.lead_grouped` and
 * `onsite_web_lead` all report 4 — one lead counted four ways. A "top 10 action
 * types" built by sorting the JSONB keys would spend half its rows restating
 * the same events, and an operator reading it would conclude the account
 * produced 2 072 engagements and 16 leads.
 *
 * Neither of the two obvious fixes is right:
 *
 * - **Summing the duplicates** is the double count stated plainly.
 * - **Dropping the duplicates silently** hides that Meta reported them, and the
 *   next person to query the JSONB directly finds numbers the dashboard denies.
 *
 * So the table collapses each group to its canonical type — the one Ads Manager
 * shows, first in the list — and *names the aliases it absorbed* on the row.
 * The number matches Ads Manager, and the reason the other names are missing is
 * on screen rather than in a comment.
 *
 * ## Why this is not more action families
 *
 * Same reason as the conversion catalog, and worth restating because this file
 * has far more group definitions than `META_ACTION_FAMILIES` has families.
 * Nothing here feeds a promoted column. A group is a read-time presentation
 * choice over stored JSONB, so a wrong grouping shows a wrong label on a
 * diagnostic table; a wrong family corrupts `leads` for every row written under
 * it. That asymmetry is what lets this list be broad and `META_ACTION_FAMILIES`
 * stay at three, and it is why `META_ACTION_MAPPING_VERSION` is untouched.
 */

import { parseCountText } from '../sync/metric-number';
import type { MetaActionBreakdown } from '../sync/meta-action-mapping';

/**
 * A set of type names Meta reports for one underlying event.
 *
 * `canonical` is what the table shows and is the name Ads Manager uses, so the
 * figure reconciles with the column an operator checks it against. `aliases`
 * are the other spellings of the *same* event, absorbed into the canonical row
 * and listed on it.
 *
 * Crucially this is a *collapse*, not a sum: the group's total is the largest
 * member, not the addition of them. See `readActionGroup`.
 */
export type MetaActionTypeGroup = {
  canonical: string;
  aliases: readonly string[];
  label: string;
  /**
   * Whether the group is already presented elsewhere with its own card.
   *
   * Not a reason to hide it — an operator looking at "all actions" expects
   * leads to be in the list — but a reason the UI can mark it, so the same
   * events are not read as additional to the KPI above them.
   */
  promoted: boolean;
};

/**
 * Groups of names that mean one event.
 *
 * Every membership below was measured on the production account rather than
 * taken from documentation: each group's members reported *identical* totals
 * over the same period, which is the evidence that they are one event. A group
 * asserted without that evidence would be this file's version of the mistake it
 * exists to prevent.
 */
export const META_ACTION_TYPE_GROUPS: readonly MetaActionTypeGroup[] = [
  {
    /**
     * 1 036 against 1 036 on the measured account.
     *
     * Meta documents these as different scopes — engagement with the Page
     * versus with the post — and on an account whose delivery is all in-feed
     * post ads they coincide exactly. `page_engagement` is canonical because it
     * is the broader definition, so it stays correct if the account later runs
     * a format where the two diverge; if they ever *do* diverge the equality
     * test in the spec fails and this grouping gets revisited with data.
     */
    canonical: 'page_engagement',
    aliases: ['post_engagement'],
    label: 'Envolvimento com a publicação',
    promoted: false,
  },
  {
    /**
     * All four reported 4 on the measured account — the same submission echoed
     * by the Meta Leads CRM under three further names. This mirrors the lead
     * family in `meta-action-mapping.ts` exactly, and deliberately: if the two
     * lists disagreed, the table would contradict the `leads` KPI above it.
     */
    canonical: 'lead',
    aliases: [
      'onsite_conversion.lead_grouped',
      'onsite_conversion.lead',
      'onsite_web_lead',
      'offsite_complete_registration_add_meta_leads',
      'offsite_content_view_add_meta_leads',
      'offsite_search_add_meta_leads',
    ],
    label: 'Cadastros',
    promoted: true,
  },
  {
    /**
     * 12 against 11, which is why these are grouped but the *canonical* one is
     * the narrower `_7d` type rather than the larger `total_messaging_connection`.
     *
     * The KPI column uses `messaging_conversation_started_7d` because it is the
     * Ads Manager column an operator reconciles against, and this table must
     * agree with that column or the two readings of one screen disagree. The
     * larger number is the alias here, not the headline.
     */
    canonical: 'onsite_conversion.messaging_conversation_started_7d',
    aliases: ['onsite_conversion.total_messaging_connection'],
    label: 'Conversas por mensagem iniciadas',
    promoted: true,
  },
  {
    /** 27 against 24: net and gross of the same interactions. */
    canonical: 'post_interaction_gross',
    aliases: ['post_interaction_net'],
    label: 'Interações com a publicação',
    promoted: false,
  },
];

/** Human labels for types that stand alone — no group, no alias. */
const STANDALONE_LABELS: Readonly<Record<string, string>> = {
  video_view: 'Visualizações do vídeo (3s)',
  link_click: 'Cliques no link',
  post_reaction: 'Reações',
  comment: 'Comentários',
  post: 'Compartilhamentos',
  'onsite_conversion.post_save': 'Salvamentos',
  'onsite_conversion.post_net_like': 'Curtidas na Página',
  'onsite_conversion.post_unlike': 'Descurtidas na Página',
  'onsite_conversion.post_net_comment': 'Comentários na publicação',
  'onsite_conversion.messaging_first_reply': 'Primeiras respostas',
  'onsite_conversion.messaging_welcome_message_view':
    'Mensagens de boas-vindas vistas',
  'onsite_conversion.messaging_user_depth_2_message_send':
    'Conversas com 2 mensagens',
  'onsite_conversion.messaging_user_depth_3_message_send':
    'Conversas com 3 mensagens',
  'onsite_conversion.messaging_user_depth_5_message_send':
    'Conversas com 5 mensagens',
  landing_page_view: 'Visualizações da página de destino',
  page_like: 'Curtidas na Página',
  rsvp: 'Confirmações de presença',
  app_install: 'Instalações do aplicativo',
};

/** The types every group claims, canonical and alias alike. */
const GROUPED_TYPES = new Set(
  META_ACTION_TYPE_GROUPS.flatMap((group) => [
    group.canonical,
    ...group.aliases,
  ]),
);

/**
 * One row of the action-type table.
 *
 * `absorbed` is what keeps the collapse honest: it names the aliases that were
 * folded into this row and that therefore do not appear on their own. An empty
 * array means nothing was hidden.
 */
export type MetaActionTypeTotal = {
  /** The canonical type name, which is also the row's stable id. */
  type: string;
  label: string;
  count: string;
  /** Alias names this row absorbed, in the order the group declares them. */
  absorbed: readonly string[];
  /** Whether a KPI card elsewhere already shows this same event. */
  promoted: boolean;
  /** False when the type is not in this catalog and is shown by its raw name. */
  known: boolean;
};

/**
 * A group's total over one already-aggregated action map.
 *
 * **The largest member, not the sum** — the single most important line in this
 * file. The members are one event reported under several names, so adding them
 * multiplies a real number by however many names Meta happened to send. Taking
 * the maximum rather than the first present (which is what the families and the
 * conversion catalog do) is deliberate and different: those rules exist to pick
 * one authoritative alias, while here the members can legitimately differ
 * slightly — 12 against 11 for messaging — and the reader's question is "how
 * many of this thing happened", for which the fullest count Meta offers is the
 * better answer than whichever name sorted first.
 *
 * Null when no member appeared at all, never zero: an account that never
 * reported a type and one that reported zero of it are different facts.
 */
export function readActionGroup(
  breakdown: MetaActionBreakdown,
  group: MetaActionTypeGroup,
): string | null {
  let best: bigint | null = null;

  for (const type of [group.canonical, ...group.aliases]) {
    const stored = breakdown.counts[type];

    if (stored === undefined) continue;

    const parsed = parseCountText(stored.split('.')[0]);

    if (parsed === null) continue;

    const value = BigInt(parsed);

    if (best === null || value > best) best = value;
  }

  return best === null ? null : best.toString();
}

/** The group a type belongs to, or null when it stands alone. */
export function findActionTypeGroup(type: string): MetaActionTypeGroup | null {
  return (
    META_ACTION_TYPE_GROUPS.find(
      (group) => group.canonical === type || group.aliases.includes(type),
    ) ?? null
  );
}

/** Whether any group claims this type — canonical or alias. */
export function isGroupedActionType(type: string): boolean {
  return GROUPED_TYPES.has(type);
}

/**
 * The pt-BR label for a type, or null when this catalog has never seen it.
 *
 * Null rather than a prettified version of the raw name. A type this file does
 * not know is shown verbatim so it is searchable against Meta's own
 * documentation, and inventing "Onsite Conversion Post Save" from
 * `onsite_conversion.post_save` would produce a label that looks authored and
 * is not.
 */
export function findActionTypeLabel(type: string): string | null {
  const group = findActionTypeGroup(type);

  if (group) return group.label;

  return STANDALONE_LABELS[type] ?? null;
}
