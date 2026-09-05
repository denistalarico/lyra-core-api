/**
 * The business mode of the context an analysis was run for.
 *
 * ## Why this is a dimension and not a fact source
 *
 * `IntelligenceFactSource` describes a domain that can answer "how many, over
 * this window, at this grain". Every concept in it — `grain`, day buckets, an
 * aggregable series, `freshness.lastSyncedAt` — presupposes a *measurement over
 * time*. Business Mode is none of those things: it is a single label on the
 * context, it has no window, it cannot be summed, and asking a fact source for
 * it would mean inventing a fake day dimension so a string could ride along.
 *
 * `IntelligenceFactSet.businessMode` has been `string | null` since I2, and the
 * LeadFlow adapter has been returning a hardcoded `null` there with a comment
 * saying it "becomes a dimension the day a caller needs to slice by it — which
 * is what it is, rather than a property of the set". This file is that day, and
 * it takes the smaller of the two shapes the note allowed for.
 *
 * So: a resolved value plus the provenance needed to trust it. No source
 * interface beyond the one port the projector calls, because one method that
 * returns one label does not need an abstraction layered over it.
 */

/**
 * What the queried label means with respect to *time*.
 *
 * A single member today, and named rather than implied, because the whole
 * hazard this type exists to contain is that a reader assumes the other one.
 *
 * `current_context_dimension` — the mode the context is configured with **right
 * now**, read at query time. It is not a statement about the period being
 * queried. A context that was a clinic in January and is a restaurant today
 * reports `restaurants_food` against January's numbers, because nothing in the
 * system recorded the change.
 *
 * The absent member is `historical_fact_dimension`, and it is absent because no
 * storage supports it: `leadflow_client_settings.business_mode_key` is a mutable
 * column with no history table, no versioned settings row, and no event
 * recording a mode change (audited in I5 §7). Adding the member without the
 * storage would let a benchmark silently claim a January cohort belonged to a
 * mode nobody can show it had.
 *
 * I6 has to make this choice explicitly — accept the current mode, require a
 * snapshot, or start versioning changes from that point forward. Leaving the
 * union open with one honest member is what forces that decision to be visible
 * rather than inherited.
 */
export type BusinessModeTemporalSemantics = 'current_context_dimension';

/**
 * Whether a stored key means anything, and if not, which kind of nothing.
 *
 * Three states rather than a nullable string, because two of them are routinely
 * conflated and they call for opposite responses:
 *
 * - `configured` — a key is stored and the catalog recognises it. Usable.
 * - `unconfigured` — no key is stored for this context. Expected, not a
 *   problem: a Social-only tenant has no LeadFlow settings row at all, and it
 *   must be able to read its own ad spend without one.
 * - `unknown_key` — a key *is* stored and the catalog does not recognise it.
 *   This is a data-quality problem: a custom template was deleted, a key was
 *   renamed, or a row was written by something that did not validate. The key
 *   is still reported verbatim, because collapsing it to null would erase the
 *   only evidence of the inconsistency and make a broken context look like an
 *   empty one.
 */
export type BusinessModeResolution =
  | 'configured'
  | 'unconfigured'
  | 'unknown_key';

/**
 * Where the label physically came from.
 *
 * Names the storage, not the projector. Intelligence composes this value; it
 * does not own it, and a provenance saying `intelligence-analytics` would send
 * anyone auditing a wrong mode to the layer that merely passed it through.
 *
 * `leadflow_client_settings` is the only member today because it is the only
 * place the value is stored — `/platform/business-profile` and
 * `/platform/business-modes` are neutral HTTP surfaces over that same table
 * (they hold no storage of their own), so a reader arriving through them is
 * still reading this row.
 */
export type BusinessModeSource = 'leadflow_client_settings';

/**
 * The context's business mode, as a dimension of an intelligence response.
 *
 * ## Ownership versus storage
 *
 * Conceptually this belongs to the **company/context** — the tenant, workspace
 * and managed client an analysis was run for — and not to any one product's
 * subscription. Physically it is a column on `leadflow_client_settings` today.
 * Those two facts are both true and must not be collapsed:
 *
 * - Because ownership is contextual, there is exactly one of these per context.
 *   No `socialBusinessMode`, no `leadflowBusinessMode`. A context that adds a
 *   second product does not acquire a second mode.
 * - Because storage is LeadFlow's, `source` says so plainly, and a context with
 *   no LeadFlow settings row resolves `unconfigured` rather than failing.
 *
 * If the value later moves to a platform-owned table, `source` gains a member
 * and every consumer keeps working — which is the reason it is a field rather
 * than an assumption.
 */
export type BusinessModeDimension = {
  /**
   * The stored key, verbatim, or null when nothing is stored.
   *
   * Non-null with `resolution: 'unknown_key'` is a legitimate combination and
   * the reason this is not simply `string | null`: the key is reported so it can
   * be investigated, and `resolution` is what says it may not be used to
   * segment.
   */
  key: string | null;
  /**
   * The catalog's human label for `key`, or null when there is none to give.
   *
   * Null whenever `resolution` is not `configured` — an unrecognised key has no
   * label by definition, and inventing one from the key itself (title-casing
   * `clinics_esthetics`) would present a guess in the same field a real label
   * occupies.
   */
  label: string | null;
  resolution: BusinessModeResolution;
  source: BusinessModeSource;
  temporalSemantics: BusinessModeTemporalSemantics;
};

/**
 * The dimension for a context that has no business mode configured.
 *
 * A named constant rather than an inline literal at each call site, so that
 * "Social-only tenant" and "LeadFlow context with the field blank" produce
 * byte-identical output. The two are the same answer and a reader must not be
 * able to tell them apart by shape.
 */
export const UNCONFIGURED_BUSINESS_MODE: BusinessModeDimension = {
  key: null,
  label: null,
  resolution: 'unconfigured',
  source: 'leadflow_client_settings',
  temporalSemantics: 'current_context_dimension',
};

/**
 * The limitation every response carrying this dimension must state.
 *
 * Unconditional, and worded as a fact about the field rather than a warning
 * about the data. It applies to a perfectly healthy, correctly configured
 * context — the mode really is current, and a reader comparing a March cohort
 * across contexts needs to know that before drawing a conclusion from it.
 */
export const BUSINESS_MODE_CURRENT_ONLY_LIMITATION =
  'O Business Mode reflete a configuração atual do contexto e não é um ' +
  'retrato histórico do período consultado. Nenhum armazenamento registra ' +
  'quando um contexto mudou de modo, portanto um contexto que mudou depois do ' +
  'início do período aparece sob o modo de hoje.';

/**
 * The two independent quality flags derived from a resolution.
 *
 * A pure function beside the type rather than a fold repeated in each
 * projector. Both I3 and I4 report these flags, and the mapping from three
 * resolution states to two booleans has one non-obvious case —
 * `unknown_key` is configured *and* unrecognised — which two hand-written
 * copies would eventually disagree about.
 */
export function businessModeQuality(dimension: BusinessModeDimension): {
  configured: boolean;
  recognized: boolean;
  temporalSemantics: BusinessModeTemporalSemantics;
} {
  return {
    configured: dimension.resolution !== 'unconfigured',
    recognized: dimension.resolution === 'configured',
    temporalSemantics: dimension.temporalSemantics,
  };
}

/** Stated when a stored key is not in the catalog. */
export const BUSINESS_MODE_UNKNOWN_KEY_LIMITATION =
  'A chave de Business Mode armazenada não existe no catálogo. Ela é ' +
  'reportada literalmente para investigação e não deve ser usada para ' +
  'segmentar ou comparar.';
