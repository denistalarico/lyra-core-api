import { In, type Repository } from 'typeorm';
import { InboxAttributionObservationEntity } from '../../entities/inbox-attribution-observation.entity';
import type { InboxMessageEntity } from '../../entities/inbox-message.entity';

/**
 * The single source of the Instagram/Messenger messaging window (D-IX-4).
 *
 * Meta lets a business answer freely for 24 hours after the contact's last
 * message. A lead who arrived by clicking an ad may be answered for up to seven
 * days, and between 24 hours and seven days a *person* — never the agent or an
 * automation — may still answer with the `HUMAN_AGENT` tag (D-IX-3).
 *
 * Every surface that asks "may this go out now?" reads the answer here: the
 * channel services before sending, the follow-up consumer before trying, and
 * the composer through the API. Before this each one counted 24 hours on its
 * own and they could disagree.
 */
export const META_STANDARD_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const META_HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
export const META_AD_REFERRAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

/** Refusal for an agent or automation asking for the human-only extension. */
export const HUMAN_AGENT_TAG_REQUIRES_HUMAN = 'human_agent_tag_requires_human';

export type MetaMessagingWindowSource = 'standard' | 'ad_referral';

export interface MetaMessagingWindow {
  lastInboundAt: Date | null;
  /** Free replies (agent, automation, person) until this instant. */
  standardExpiresAt: Date | null;
  /**
   * A person may still answer with `HUMAN_AGENT` until this instant. Null when
   * the tag is switched off: there is no extension to offer.
   */
  humanAgentExpiresAt: Date | null;
  source: MetaMessagingWindowSource;
}

export type MetaWindowActor = 'human' | 'automated';

export type MetaWindowVerdict =
  | { allowed: true; tag: 'HUMAN_AGENT' | null }
  | {
      allowed: false;
      reason: 'outside_standard_window' | typeof HUMAN_AGENT_TAG_REQUIRES_HUMAN;
    };

export function metaAdWindow7dEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.INBOX_META_AD_WINDOW_7D_ENABLED === 'true';
}

export function metaHumanAgentTagEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.INBOX_META_HUMAN_AGENT_TAG_ENABLED === 'true';
}

/**
 * Pure: the window that follows from the last inbound and, when there is one,
 * the ad click that opened the conversation.
 *
 * The ad extension is counted from the observed click, not from the last
 * message, so a lead who clicked weeks ago and wrote yesterday is on the
 * ordinary 24 hours. A conversation without an inbound is closed: Meta only
 * accepts a reply, never a first message.
 */
export function resolveMetaMessagingWindow(
  lastInbound: { occurredAt: Date } | null,
  adReferral: { observedAt: Date } | null,
  options: { adWindow7dEnabled: boolean; humanAgentTagEnabled: boolean },
): MetaMessagingWindow {
  if (!lastInbound) {
    return {
      lastInboundAt: null,
      standardExpiresAt: null,
      humanAgentExpiresAt: null,
      source: 'standard',
    };
  }
  const lastInboundMs = lastInbound.occurredAt.getTime();
  let standardExpiresMs = lastInboundMs + META_STANDARD_WINDOW_MS;
  let source: MetaMessagingWindowSource = 'standard';
  if (options.adWindow7dEnabled && adReferral) {
    const adExpiresMs =
      adReferral.observedAt.getTime() + META_AD_REFERRAL_WINDOW_MS;
    if (adExpiresMs > standardExpiresMs) {
      standardExpiresMs = adExpiresMs;
      source = 'ad_referral';
    }
  }
  const humanAgentExpiresMs = lastInboundMs + META_HUMAN_AGENT_WINDOW_MS;
  return {
    lastInboundAt: lastInbound.occurredAt,
    standardExpiresAt: new Date(standardExpiresMs),
    humanAgentExpiresAt:
      options.humanAgentTagEnabled && humanAgentExpiresMs > standardExpiresMs
        ? new Date(humanAgentExpiresMs)
        : null,
    source,
  };
}

/**
 * What the window allows this actor to do at `now`.
 *
 * Inside the standard window nothing is tagged. Past it only a person gets
 * the tag; the agent and automations are refused with a code that says why,
 * so a follow-up records "outside the window" instead of a provider error.
 */
export function evaluateMetaWindow(
  window: MetaMessagingWindow,
  actor: MetaWindowActor,
  now: Date = new Date(),
): MetaWindowVerdict {
  const nowMs = now.getTime();
  if (window.standardExpiresAt && nowMs < window.standardExpiresAt.getTime()) {
    return { allowed: true, tag: null };
  }
  const insideHumanWindow = Boolean(
    window.humanAgentExpiresAt && nowMs < window.humanAgentExpiresAt.getTime(),
  );
  if (!insideHumanWindow) {
    return { allowed: false, reason: 'outside_standard_window' };
  }
  return actor === 'human'
    ? { allowed: true, tag: 'HUMAN_AGENT' }
    : { allowed: false, reason: HUMAN_AGENT_TAG_REQUIRES_HUMAN };
}

/**
 * Reads the two facts the window needs and resolves it.
 *
 * The inbound lookup is the exact query the channel services always ran, so
 * nothing about how "last inbound" is defined changes. The ad referral is the
 * I4 observation (`inbox_attribution_observations`) and is only read when the
 * extension is switched on.
 */
export async function loadMetaMessagingWindow(input: {
  messages: Repository<InboxMessageEntity>;
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  env?: NodeJS.ProcessEnv;
}): Promise<MetaMessagingWindow> {
  const env = input.env ?? process.env;
  const adWindow7dEnabled = metaAdWindow7dEnabled(env);
  const lastInbound = await input.messages.findOne({
    where: {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      direction: 'inbound',
    },
    select: { id: true, occurredAt: true },
    order: { occurredAt: 'DESC' },
  });
  const adReferral =
    adWindow7dEnabled && lastInbound
      ? await input.messages.manager
          .getRepository(InboxAttributionObservationEntity)
          .findOne({
            where: {
              tenantId: input.tenantId,
              workspaceId: input.workspaceId,
              conversationId: input.conversationId,
              // WhatsApp reports `ad`; Messenger documents `ADS`.
              sourceType: In(['ad', 'ads', 'AD', 'ADS']),
            },
            select: { id: true, observedAt: true },
            order: { observedAt: 'DESC' },
          })
      : null;
  return resolveMetaMessagingWindow(lastInbound, adReferral, {
    adWindow7dEnabled,
    humanAgentTagEnabled: metaHumanAgentTagEnabled(env),
  });
}
