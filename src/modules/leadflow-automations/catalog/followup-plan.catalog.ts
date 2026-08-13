import type {
  LeadFlowFollowupChannel,
  LeadFlowFollowupStepConfig,
} from '../types/leadflow-automation.types';

/**
 * The follow-up cadence, as a closed vocabulary.
 *
 * Before this, a follow-up was an open list of steps with a free-form delay in
 * minutes, and the operator was asked to invent both. The cadence is not really
 * a free variable: it is bounded on one side by the WhatsApp 24-hour messaging
 * window (a reply after it needs an approved template, which is a different kind
 * of message) and on the other by what a person will tolerate. So the platform
 * fixes four attempts, and the only number left to decide is how soon the first
 * one goes out.
 *
 *   d0 — same day, 1h to 6h after the message that went unanswered
 *   d1 — next day, at 22h: the last hour that is still safely inside the window
 *   d3 — three days later, on an approved template
 *   d7 — seven days later, on an approved template
 *
 * `stepKey` is therefore the contract, not the stored delay: everything but d0's
 * offset is derived from the key. A stored `delayMinutes` for d1/d3/d7 is read
 * as legacy noise and normalized away.
 */
export const FOLLOWUP_STEP_KEYS = ['d0', 'd1', 'd3', 'd7'] as const;

export type FollowupStepKey = (typeof FOLLOWUP_STEP_KEYS)[number];

/** Canonical offset from the baseline message, in minutes. */
export const FOLLOWUP_STEP_DELAY_MINUTES: Record<FollowupStepKey, number> = {
  d0: 3 * 60,
  d1: 22 * 60,
  d3: 3 * 24 * 60,
  d7: 7 * 24 * 60,
};

/** The band the operator may choose from for the first attempt. */
export const FOLLOWUP_D0_MIN_HOURS = 1;
export const FOLLOWUP_D0_MAX_HOURS = 6;

/**
 * Attempts that answer inside the conversation the lead opened, and therefore
 * carry no channel choice at all: they leave through the same connection the
 * lead used, exactly like the CSAT request. Both land inside the 24-hour window,
 * so they go out as free text.
 */
export const FOLLOWUP_IN_CONVERSATION_STEPS: readonly FollowupStepKey[] = [
  'd0',
  'd1',
];

/**
 * Transports that can carry an attempt once the messaging window has closed.
 * Only WhatsApp is integrated; the other two are declared so the surface can
 * show them as coming, and so the runtime refuses them explicitly rather than
 * by omission.
 */
export const FOLLOWUP_OUTBOUND_CHANNELS: readonly LeadFlowFollowupChannel[] = [
  'whatsapp',
  'sms',
  'email',
];

export const FOLLOWUP_OUTBOUND_CHANNELS_AVAILABLE: readonly LeadFlowFollowupChannel[] =
  ['whatsapp'];

/** Quiet-hours envelope: nothing reaches a lead outside it when the toggle is on. */
export const FOLLOWUP_QUIET_HOURS = { startHour: 7, endHour: 20 } as const;

export function isFollowupStepKey(value: unknown): value is FollowupStepKey {
  return (
    typeof value === 'string' &&
    (FOLLOWUP_STEP_KEYS as readonly string[]).includes(value)
  );
}

export function isInConversationStep(stepKey: string): boolean {
  return (FOLLOWUP_IN_CONVERSATION_STEPS as readonly string[]).includes(stepKey);
}

/** Whether the step is one this phase can actually deliver on the given channel. */
export function isDeliverableOutboundChannel(channel: string): boolean {
  return (FOLLOWUP_OUTBOUND_CHANNELS_AVAILABLE as readonly string[]).includes(
    channel,
  );
}

export function clampD0Hours(value: unknown): number {
  const hours =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.round(value)
      : FOLLOWUP_STEP_DELAY_MINUTES.d0 / 60;
  return Math.min(
    FOLLOWUP_D0_MAX_HOURS,
    Math.max(FOLLOWUP_D0_MIN_HOURS, hours),
  );
}

/** One attempt, after normalization: what the runtime and the surfaces agree on. */
export interface FollowupPlanStep {
  stepKey: FollowupStepKey;
  enabled: boolean;
  /** Offset from the baseline. Only d0 varies; the rest are canonical. */
  delayMinutes: number;
  /** Empty for d0/d1 — those follow the conversation. */
  channels: LeadFlowFollowupStepConfig['channels'];
}

/**
 * Normalizes whatever is stored into the four canonical attempts.
 *
 * Rows written before this contract carry `d1`/`d3`/`d7` with arbitrary delays
 * and no `enabled` flag, and they may carry a channel list on an attempt that
 * now follows the conversation. All of that is read charitably and rewritten:
 * an attempt counts as enabled when it says so, or — for a legacy row that
 * cannot say so — when it carries a channel that was switched on.
 */
export function normalizeFollowupPlan(value: unknown): FollowupPlanStep[] {
  const stored = new Map<string, Record<string, unknown>>();
  if (Array.isArray(value)) {
    for (const step of value) {
      if (
        step &&
        typeof step === 'object' &&
        !Array.isArray(step) &&
        typeof (step as { stepKey?: unknown }).stepKey === 'string'
      ) {
        stored.set(
          (step as { stepKey: string }).stepKey,
          step as Record<string, unknown>,
        );
      }
    }
  }

  // A legacy `d1` set to a few hours was the operator asking for a same-day
  // attempt with the only field the old screen had. Read it as d0, so their
  // intent survives the migration to a named cadence.
  const legacyD1 = stored.get('d1');
  if (
    !stored.has('d0') &&
    legacyD1 &&
    typeof legacyD1.delayMinutes === 'number' &&
    legacyD1.delayMinutes <= FOLLOWUP_D0_MAX_HOURS * 60
  ) {
    stored.set('d0', legacyD1);
    stored.delete('d1');
  }

  return FOLLOWUP_STEP_KEYS.map((stepKey) => {
    const step = stored.get(stepKey);
    const channels = Array.isArray(step?.channels)
      ? (step.channels as LeadFlowFollowupStepConfig['channels']).filter(
          (channel) =>
            channel &&
            typeof channel === 'object' &&
            typeof channel.channel === 'string',
        )
      : [];
    return {
      stepKey,
      enabled: readEnabled(step, channels),
      delayMinutes:
        stepKey === 'd0'
          ? clampD0Hours(
              typeof step?.delayMinutes === 'number'
                ? step.delayMinutes / 60
                : undefined,
            ) * 60
          : FOLLOWUP_STEP_DELAY_MINUTES[stepKey],
      channels: isInConversationStep(stepKey) ? [] : channels,
    };
  });
}

/** The attempts that will actually be tried, in cadence order. */
export function enabledFollowupSteps(value: unknown): FollowupPlanStep[] {
  return normalizeFollowupPlan(value).filter((step) => step.enabled);
}

/** Serializes back to the stored shape, dropping everything derivable. */
export function toStoredFollowupSteps(
  steps: FollowupPlanStep[],
): LeadFlowFollowupStepConfig[] {
  return steps.map((step) => ({
    stepKey: step.stepKey,
    enabled: step.enabled,
    delayMinutes: step.delayMinutes,
    channels: step.channels,
  }));
}

function readEnabled(
  step: Record<string, unknown> | undefined,
  channels: LeadFlowFollowupStepConfig['channels'],
): boolean {
  if (!step) return false;
  if (typeof step.enabled === 'boolean') return step.enabled;
  return channels.some((channel) => channel.enabled === true);
}
