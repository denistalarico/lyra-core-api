/** A UI action the frontend executes; validated against an allowlist here. */
export type OrionUiAction =
  | { action: 'set_theme'; value: 'light' | 'dark' | 'system' }
  | { action: 'navigate'; value: string };

/** Help Center links found during the turn (no IDs, routes only). */
export type OrionCard = {
  kind: 'help_links';
  items: Array<{ title: string; summary: string | null; route: string | null }>;
};

export type OrionTurnLimit = 'monthly_budget' | 'hourly_rate';

/**
 * OR5 — a change the Orion proposed. Nothing ran: the user confirms it with
 * `POST /leadflow/agents/room/actions/:id/confirm` (`expectedRevision`).
 * `id` is for that call only; the card shows `title`/`summary`.
 */
export type OrionProposal = {
  id: string;
  intent: string;
  status: 'pending_confirmation' | 'confirmed' | 'cancelled';
  revision: number;
  canConfirm: boolean;
  validationIssues: string[];
  title: string;
  summary: string;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  timezone: string | null;
};

/**
 * `POST /orion/turns` answer. `proposal` (OR5): the last change the Orion
 * proposed in the turn, to confirm on the card; `null` when none.
 */
export type OrionTurnResponse = {
  text: string;
  card: OrionCard | null;
  uiAction: OrionUiAction | null;
  proposal: OrionProposal | null;
  meta: {
    /** False when the answer did not come from the LLM (limit fallback). */
    ai: boolean;
    mode: 'mock' | 'live';
    limit: OrionTurnLimit | null;
    turnId: string | null;
    tools: string[];
  };
};

export type OrionStatusResponse = {
  available: boolean;
  /** The tenant's monthly AI ceiling is reached (no amounts, ever). */
  aiLimitReached: boolean;
};
