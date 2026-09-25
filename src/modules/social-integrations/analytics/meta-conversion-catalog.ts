/**
 * The conversion events a pixel, an app or a subscription flow can report.
 *
 * ## Why this is a catalog and not more families
 *
 * `META_ACTION_FAMILIES` in `meta-action-mapping.ts` decides what `leads`,
 * `conversions` and `conversion_value` mean. Adding to it changes those columns
 * for the same input, which is precisely the condition
 * `META_ACTION_MAPPING_VERSION` exists to stamp — so every family added splits
 * the history of `conversions` into another era.
 *
 * Nothing here is a family. These entries are read out of the stored `actions`
 * payload on demand, contribute to no promoted column, and therefore **cannot**
 * change `leads`, `conversions`, `conversion_value` or `video_views` for any
 * row past or future. That is the whole reason the catalog has this shape: it
 * lets the product answer "how many add-to-carts?" without touching the four
 * numbers a client is invoiced against, and without a version bump.
 *
 * The cost is that none of these is indexable or summable in SQL as cheaply as
 * a column. That is the right trade here and it is not the trade `leads` faced:
 * these are diagnostic metrics, hidden by default, read by an operator who
 * asked for them — not figures on the front of a report.
 *
 * ## Nothing here needs to be collected
 *
 * `INSIGHTS_FIELDS` already requests `actions` and `action_values`, and Meta
 * answers those with **every** type the account reported — not a requested
 * subset. `readActionMap` stores all of them, claimed by a family or not. So
 * the day a client connects a pixel, every type below starts arriving and being
 * stored with no code change, no extra field, and no additional quota cost.
 *
 * Confirmed against production: the measured account reports 25 action types
 * and not one of them is on this list, because it has never had a pixel. The
 * catalog is therefore written from Meta's documented type names rather than
 * from observation — see `verified` on each entry, which says which is which.
 *
 * ## Aliases, and why they are ordered
 *
 * Meta reports one event under several names — the same trap that produced the
 * families. `offsite_conversion.fb_pixel_purchase`, `omni_purchase` and
 * `purchase` can all appear on one row for one sale. So an entry is an ordered
 * alias list read exactly like a family: **the first name present wins and the
 * rest are ignored**. Summing the aliases would multiply a real number by up to
 * three.
 *
 * The canonical (Ads Manager) name comes first, so the figure reconciles with
 * the column an operator compares it against.
 */

import { parseCountText, parseScaledAmount } from '../sync/metric-number';
import type { MetaActionBreakdown } from '../sync/meta-action-mapping';
import { META_ACTION_FAMILIES } from '../sync/meta-action-mapping';

/** Which part of a business an entry describes. */
export type MetaConversionGroup = 'ecommerce' | 'site' | 'app' | 'subscription';

export type MetaConversionDefinition = {
  /** Stable id used by the API and the metric catalog. Not Meta's name. */
  id: string;
  /** pt-BR label, matching Ads Manager's own wording where one exists. */
  label: string;
  group: MetaConversionGroup;
  /**
   * Alias names, most canonical first. First present wins.
   *
   * @see the module docblock — summing these is the double-count this whole
   * structure exists to prevent.
   */
  types: readonly string[];
  /**
   * Whether the event carries money in `action_values`.
   *
   * Only these can produce a value or a ROAS. A cost per add-to-cart is always
   * derivable; a *return* on add-to-cart is not a thing, and the flag is what
   * stops a caller from asking for one.
   */
  monetary: boolean;
  /**
   * Whether this type has been observed on a real account by this codebase.
   *
   * Every entry is currently `false` and that is honest rather than
   * provisional: no connected account has ever had a pixel. A `false` means the
   * alias list came from Meta's documentation, so a missing alias would show up
   * as an undercount rather than as an error. Flip it on observation.
   */
  verified: boolean;
};

/**
 * The catalog.
 *
 * Deliberately broad where the families are deliberately narrow, and the
 * asymmetry is the point: a family is a promise about a promoted column, so a
 * wrong guess corrupts a stored number. An entry here is a read-time lookup, so
 * a wrong guess returns null and costs nothing. Breadth is cheap on this side
 * of the line and expensive on the other.
 */
export const META_CONVERSION_CATALOG: readonly MetaConversionDefinition[] = [
  // ─── E-commerce ────────────────────────────────────────────────────────────
  {
    /**
     * Purchase is the one event that is *also* a family, and it stays in both
     * on purpose. The family feeds `conversions` and `conversion_value`, which
     * is what ROAS divides; this entry exposes the same event as a standalone
     * count so a shop can be read without inferring it from `conversions` —
     * which also holds leads and registrations.
     *
     * The two agree by construction: same alias list, same first-present rule.
     */
    id: 'purchase',
    label: 'Compras no site',
    group: 'ecommerce',
    types: [
      'purchase',
      'omni_purchase',
      'offsite_conversion.fb_pixel_purchase',
    ],
    monetary: true,
    verified: false,
  },
  {
    id: 'add_to_cart',
    label: 'Adições ao carrinho',
    group: 'ecommerce',
    types: [
      'add_to_cart',
      'omni_add_to_cart',
      'offsite_conversion.fb_pixel_add_to_cart',
    ],
    monetary: true,
    verified: false,
  },
  {
    id: 'initiate_checkout',
    label: 'Finalizações de compra iniciadas',
    group: 'ecommerce',
    types: [
      'initiate_checkout',
      'omni_initiated_checkout',
      'offsite_conversion.fb_pixel_initiate_checkout',
    ],
    monetary: true,
    verified: false,
  },
  {
    id: 'add_payment_info',
    label: 'Informações de pagamento adicionadas',
    group: 'ecommerce',
    types: ['add_payment_info', 'offsite_conversion.fb_pixel_add_payment_info'],
    monetary: false,
    verified: false,
  },
  {
    id: 'add_to_wishlist',
    label: 'Adições à lista de desejos',
    group: 'ecommerce',
    types: [
      'add_to_wishlist',
      'omni_add_to_wishlist',
      'offsite_conversion.fb_pixel_add_to_wishlist',
    ],
    monetary: false,
    verified: false,
  },

  // ─── Site ──────────────────────────────────────────────────────────────────
  {
    id: 'view_content',
    label: 'Visualizações de conteúdo do site',
    group: 'site',
    types: [
      'view_content',
      'omni_view_content',
      'offsite_conversion.fb_pixel_view_content',
    ],
    monetary: false,
    verified: false,
  },
  {
    id: 'search',
    label: 'Pesquisas no site',
    group: 'site',
    types: ['search', 'omni_search', 'offsite_conversion.fb_pixel_search'],
    monetary: false,
    verified: false,
  },
  {
    /**
     * `contact` is a site event, not a messaging one. Meta's messaging
     * conversation types live in their own column — see
     * `MESSAGING_CONVERSATION_ACTION_TYPE` — and mixing the two would put a
     * WhatsApp conversation and a contact-form submission into one number.
     */
    id: 'contact',
    label: 'Contatos no site',
    group: 'site',
    types: ['contact', 'offsite_conversion.fb_pixel_contact'],
    monetary: false,
    verified: false,
  },
  {
    id: 'customize_product',
    label: 'Produtos personalizados',
    group: 'site',
    types: [
      'customize_product',
      'offsite_conversion.fb_pixel_customize_product',
    ],
    monetary: false,
    verified: false,
  },
  {
    id: 'find_location',
    label: 'Localizações encontradas',
    group: 'site',
    types: ['find_location', 'offsite_conversion.fb_pixel_find_location'],
    monetary: false,
    verified: false,
  },
  {
    id: 'schedule',
    label: 'Agendamentos',
    group: 'site',
    types: ['schedule', 'offsite_conversion.fb_pixel_schedule'],
    monetary: false,
    verified: false,
  },
  {
    id: 'donate',
    label: 'Doações',
    group: 'site',
    types: ['donate', 'offsite_conversion.fb_pixel_donate'],
    monetary: true,
    verified: false,
  },
  {
    id: 'submit_application',
    label: 'Candidaturas enviadas',
    group: 'site',
    types: [
      'submit_application',
      'offsite_conversion.fb_pixel_submit_application',
    ],
    monetary: false,
    verified: false,
  },

  // ─── Subscription ──────────────────────────────────────────────────────────
  {
    id: 'subscribe',
    label: 'Assinaturas',
    group: 'subscription',
    types: ['subscribe', 'offsite_conversion.fb_pixel_subscribe'],
    monetary: true,
    verified: false,
  },
  {
    id: 'start_trial',
    label: 'Períodos de teste iniciados',
    group: 'subscription',
    types: ['start_trial', 'offsite_conversion.fb_pixel_start_trial'],
    monetary: true,
    verified: false,
  },

  // ─── App ───────────────────────────────────────────────────────────────────
  {
    id: 'app_install',
    label: 'Instalações do aplicativo',
    group: 'app',
    types: ['app_install', 'mobile_app_install', 'omni_app_install'],
    monetary: false,
    verified: false,
  },
  {
    id: 'app_purchase',
    label: 'Compras no aplicativo',
    group: 'app',
    types: ['app_custom_event.fb_mobile_purchase', 'mobile_purchase'],
    monetary: true,
    verified: false,
  },
  {
    id: 'app_add_to_cart',
    label: 'Adições ao carrinho no aplicativo',
    group: 'app',
    types: ['app_custom_event.fb_mobile_add_to_cart', 'mobile_add_to_cart'],
    monetary: false,
    verified: false,
  },
  {
    id: 'app_complete_registration',
    label: 'Cadastros no aplicativo',
    group: 'app',
    types: [
      'app_custom_event.fb_mobile_complete_registration',
      'mobile_complete_registration',
    ],
    monetary: false,
    verified: false,
  },
];

/** The catalog indexed by id, built once. */
const BY_ID = new Map(META_CONVERSION_CATALOG.map((one) => [one.id, one]));

export function findConversionDefinition(
  id: string,
): MetaConversionDefinition | null {
  return BY_ID.get(id) ?? null;
}

/**
 * One conversion's count and value over an already-aggregated action map.
 *
 * Reads exactly like a family: first alias present, nothing else. Null — not
 * zero — when no alias appears, because a pixel that has never fired an event
 * and a pixel that fired none today are different facts, and only the second is
 * a measurement. Every consumer of this must keep that distinction; it is the
 * same rule `thruplays` and `messagingConversations` follow.
 */
export function readConversion(
  breakdown: MetaActionBreakdown,
  definition: MetaConversionDefinition,
): { count: string | null; value: string | null } {
  return {
    // Truncated, like `leads`: an attribution-split purchase is a fraction of
    // one sale, and rounding it up invents a sale that did not happen.
    count: firstPresentText(breakdown.counts, definition.types),
    // A non-monetary event has no value even if Meta sent one — asking for it
    // would be reading a field whose meaning the catalog says does not exist.
    value: definition.monetary
      ? firstPresentAmount(breakdown.values, definition.types)
      : null,
  };
}

function firstPresentText(
  map: Record<string, string>,
  types: readonly string[],
): string | null {
  for (const type of types) {
    const stored = map[type];

    if (stored === undefined) continue;

    const parsed = parseCountText(stored.split('.')[0]);

    if (parsed !== null) return parsed;
  }

  return null;
}

function firstPresentAmount(
  map: Record<string, string>,
  types: readonly string[],
): string | null {
  for (const type of types) {
    const stored = map[type];

    if (stored === undefined) continue;

    if (parseScaledAmount(stored) !== null) return stored;
  }

  return null;
}

/**
 * Every alias any family claims, for the overlap check below.
 *
 * Built from the families rather than restated, so it cannot drift from them.
 */
const FAMILY_TYPES = new Set(
  META_ACTION_FAMILIES.flatMap((family) => family.types),
);

/**
 * Catalog aliases that a family already claims.
 *
 * Exported for the test that pins it, and the answer is expected to be exactly
 * the purchase trio — the one event deliberately in both places. Anything else
 * appearing here is a real problem: it would mean a type feeding a promoted
 * column is also being presented as a standalone conversion, and a report could
 * show the same event twice under two names without either number being wrong
 * on its own.
 */
export function conversionTypesClaimedByFamilies(): string[] {
  return META_CONVERSION_CATALOG.flatMap((one) =>
    one.types.filter((type) => FAMILY_TYPES.has(type)),
  ).sort();
}
