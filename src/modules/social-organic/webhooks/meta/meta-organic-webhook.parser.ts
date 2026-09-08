/**
 * Splits one stored delivery into the independent logical units W1.1
 * deliberately did not split.
 *
 * W1.1 stores **one row per delivery** and, for a batch, reports
 * `unresolved_no_asset_id` rather than attributing the whole batch to
 * `entry[0].id`. That was the right call for transport, and it is precisely the
 * debt this file pays: Meta batches, so `entry` may hold several assets and each
 * `entry` several `changes`. A change is the smallest thing that has one asset,
 * one field and one payload — so a change, not a delivery and not an entry, is
 * the unit that gets scoped, dispatched and persisted.
 *
 * Nothing here re-stores the raw payload. The receipt already holds it exactly
 * once; these are in-memory views over it (§10, §2).
 */

/** One `entry[i].changes[j]`, carrying the identity of the entry it came from. */
export type MetaWebhookChange = {
  /** Index within `entry`, for safe logging and stable ordering. */
  entryIndex: number;
  /** Index within that entry's `changes`. */
  changeIndex: number;
  /** `entry[].id` — the Page id or IG professional account id. */
  externalAssetId: string | null;
  /** `entry[].time`, seconds → Date. Null when absent or unusable. */
  entryTime: Date | null;
  /** `changes[].field` — `feed`, `mention`, `comments`, `mentions`, … */
  field: string | null;
  /** `changes[].value`, only when it is a JSON object. */
  value: Record<string, unknown> | null;
};

export type MetaWebhookSplitResult = {
  /** Every change found, in document order. */
  changes: MetaWebhookChange[];
  /**
   * Structural problems that produced no change: an entry that is not an
   * object, an entry whose `changes` is not an array, a change that is not an
   * object. Counted rather than described, because the description would be the
   * payload — see §25.
   */
  malformedEntries: number;
  malformedChanges: number;
  /** True when `entry` itself is missing or not an array. */
  malformedEnvelope: boolean;
};

const MAX_EXTERNAL_ID_LENGTH = 180;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Meta sends ids as strings, but has historically sent numerics for some
 * objects, and the console's test event sends `"0"`. All three are accepted as
 * *syntactically* valid here; whether an id names an asset Lyra manages is the
 * scope resolver's question, not the parser's.
 */
export function readExternalId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, MAX_EXTERNAL_ID_LENGTH) : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/**
 * Meta timestamps are UNIX **seconds** (`entry[].time`, `value.created_time`),
 * not milliseconds. Multiplying is the whole conversion; the guard exists
 * because a payload that lies about this would otherwise produce a row dated
 * somewhere in 1970 or the year 56000, and a wrong date is worse than none.
 */
export function readUnixSeconds(value: unknown): Date | null {
  const seconds =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Flatten `entry[] × changes[]` into independent units.
 *
 * A malformed entry never costs its siblings: the loop counts the problem and
 * continues, so one bad entry in a batch of five still yields four usable
 * changes (§13, test 37). The counters travel with the result so the worker can
 * decide what a *partially* malformed delivery settles as — that decision is
 * the worker's, not the parser's.
 */
export function splitMetaWebhookDelivery(
  payload: unknown,
): MetaWebhookSplitResult {
  const changes: MetaWebhookChange[] = [];
  let malformedEntries = 0;
  let malformedChanges = 0;

  const entries = isPlainObject(payload) ? payload.entry : undefined;
  if (!Array.isArray(entries)) {
    return {
      changes,
      malformedEntries,
      malformedChanges,
      malformedEnvelope: true,
    };
  }

  entries.forEach((entry, entryIndex) => {
    if (!isPlainObject(entry)) {
      malformedEntries += 1;
      return;
    }

    const externalAssetId = readExternalId(entry.id);
    const entryTime = readUnixSeconds(entry.time);
    const entryChanges = entry.changes;

    if (!Array.isArray(entryChanges)) {
      // An entry with no `changes` array is not a change we can act on. It is
      // also how a messaging delivery looks (`entry[].messaging`), which this
      // module must ignore rather than misread.
      malformedEntries += 1;
      return;
    }

    entryChanges.forEach((change, changeIndex) => {
      if (!isPlainObject(change)) {
        malformedChanges += 1;
        return;
      }

      const field =
        typeof change.field === 'string' && change.field.trim()
          ? change.field.trim().slice(0, 64)
          : null;

      changes.push({
        entryIndex,
        changeIndex,
        externalAssetId,
        entryTime,
        field,
        value: isPlainObject(change.value) ? change.value : null,
      });
    });
  });

  return {
    changes,
    malformedEntries,
    malformedChanges,
    malformedEnvelope: false,
  };
}
