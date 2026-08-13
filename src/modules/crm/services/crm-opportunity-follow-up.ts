import type { CrmOpportunityEntity } from '../entities/crm-opportunity.entity';

/**
 * The follow-up state of a single opportunity.
 *
 * `follow_mode` has existed on the card since the beginning and never governed
 * anything — the section that edits it was disabled in the drawer. It governs
 * now, and it answers who decides the follow-up for *this* card:
 *
 *  - `automatic` — the automation decides. Its cadence, and the texts the agent
 *    proposed while reading the conversation.
 *  - `manual` — this card decides. The person switches the attempts on, picks
 *    the channels for the ones that leave the conversation, and writes the
 *    texts. Nothing is inherited and nothing is proposed.
 *  - `disabled` — no follow-up at all.
 *
 * Which mode a card starts in follows its origin, not a global default: a lead
 * the agent qualified starts automatic, a lead who arrived without ever passing
 * through the agent starts manual (there is no proposed text to send), and an
 * opportunity somebody typed into the CRM by hand starts disabled (nobody is
 * waiting on a reply that was never a conversation).
 */
export type CrmOpportunityFollowMode = 'automatic' | 'manual' | 'disabled';

export const CRM_OPPORTUNITY_FOLLOW_MODES: readonly CrmOpportunityFollowMode[] =
  ['automatic', 'manual', 'disabled'];

/** Where the metadata half of the state lives, for want of columns. */
export const OPPORTUNITY_FOLLOW_UP_METADATA_KEY = 'followUp';

export interface CrmOpportunityFollowUpTexts {
  /** The same-day attempt. */
  d0: string | null;
  /** The next-day attempt. */
  d1: string | null;
}

/**
 * What happened on one attempt, kept on the card.
 *
 * The runtime already emits a channel-result event per attempt, but an event
 * stream answers "what happened" for whoever is reading the log — not "where is
 * this lead" for whoever is looking at the board. The last outcome of each
 * attempt lives here so both the card and the drawer can say it without
 * replaying anything.
 */
export interface CrmOpportunityFollowUpAttempt {
  stepKey: string;
  /** The runtime's own result vocabulary; `sent` is the only success. */
  result: string;
  channel: string;
  at: string;
  /** The timer that produced it, so one run's channels do not fight. */
  runId: string;
}

export interface CrmOpportunityFollowUpState {
  mode: CrmOpportunityFollowMode;
  /** Last outcome per attempt, newest write wins. */
  attempts: CrmOpportunityFollowUpAttempt[];
  /**
   * The plan this card carries. Only read in manual mode — in automatic mode
   * the automation's plan is the one that governs — but kept either way so
   * switching back and forth does not erase what was configured.
   */
  steps: unknown[] | null;
  texts: CrmOpportunityFollowUpTexts;
  /** Who wrote the texts: the agent's proposal, or a person. */
  textsSource: 'agent' | 'manual' | null;
}

export function readOpportunityFollowUp(
  opportunity: Pick<
    CrmOpportunityEntity,
    'followMode' | 'followMessage' | 'metadata'
  >,
): CrmOpportunityFollowUpState {
  const stored = plainObject(
    opportunity.metadata?.[OPPORTUNITY_FOLLOW_UP_METADATA_KEY],
  );
  const texts = plainObject(stored?.texts);
  return {
    mode: readMode(opportunity.followMode),
    attempts: readAttempts(stored?.attempts),
    steps: Array.isArray(stored?.steps) ? stored.steps : null,
    texts: {
      // The column is the older home of the first text and stays authoritative
      // for it: anything that already writes `followMessage` keeps working.
      d0: nonEmpty(opportunity.followMessage) ?? nonEmpty(texts?.d0),
      d1: nonEmpty(texts?.d1),
    },
    textsSource:
      texts?.source === 'agent' || texts?.source === 'manual'
        ? texts.source
        : null,
  };
}

/**
 * Writes the parts of the state that were given, leaving the rest alone.
 *
 * Single writer on purpose: the first text lives in a column and everything
 * else in metadata, and two writers would drift.
 */
export function writeOpportunityFollowUp(
  opportunity: Pick<
    CrmOpportunityEntity,
    'followMode' | 'followMessage' | 'metadata'
  >,
  patch: {
    mode?: CrmOpportunityFollowMode;
    steps?: unknown[] | null;
    texts?: Partial<CrmOpportunityFollowUpTexts>;
    textsSource?: 'agent' | 'manual';
    /** Replaces the outcome of the attempt it names, keeping the others. */
    attempt?: CrmOpportunityFollowUpAttempt;
  },
): void {
  const current = readOpportunityFollowUp(opportunity);
  const texts = { ...current.texts, ...(patch.texts ?? {}) };

  if (patch.mode) opportunity.followMode = patch.mode;
  if (patch.texts !== undefined) opportunity.followMessage = texts.d0;

  opportunity.metadata = {
    ...(opportunity.metadata ?? {}),
    [OPPORTUNITY_FOLLOW_UP_METADATA_KEY]: {
      steps: patch.steps !== undefined ? patch.steps : current.steps,
      attempts: patch.attempt
        ? mergeAttempt(current.attempts, patch.attempt)
        : current.attempts,
      texts: {
        d0: texts.d0,
        d1: texts.d1,
        source: patch.textsSource ?? current.textsSource,
      },
    },
  };
}

/**
 * One verdict per attempt.
 *
 * The same attempt writes once per channel, so within a single run a delivery
 * must not be undone by a channel that could not deliver: a WhatsApp that went
 * out is still a follow-up the lead received, whatever the SMS did. Across runs
 * the newest verdict simply replaces the old one — `runId` is what tells the
 * two cases apart.
 */
function mergeAttempt(
  attempts: CrmOpportunityFollowUpAttempt[],
  next: CrmOpportunityFollowUpAttempt,
): CrmOpportunityFollowUpAttempt[] {
  const previous = attempts.find((item) => item.stepKey === next.stepKey);
  if (
    previous?.result === 'sent' &&
    previous.runId === next.runId &&
    next.result !== 'sent'
  ) {
    return attempts;
  }
  return [
    ...attempts.filter((item) => item.stepKey !== next.stepKey),
    next,
  ];
}

function readAttempts(value: unknown): CrmOpportunityFollowUpAttempt[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is CrmOpportunityFollowUpAttempt =>
      Boolean(item) &&
      typeof item === 'object' &&
      typeof (item as CrmOpportunityFollowUpAttempt).stepKey === 'string' &&
      typeof (item as CrmOpportunityFollowUpAttempt).result === 'string',
  );
}

function readMode(value: unknown): CrmOpportunityFollowMode {
  return CRM_OPPORTUNITY_FOLLOW_MODES.includes(
    value as CrmOpportunityFollowMode,
  )
    ? (value as CrmOpportunityFollowMode)
    : 'disabled';
}

function plainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
