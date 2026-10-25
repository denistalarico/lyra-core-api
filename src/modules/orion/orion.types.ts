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
 * `POST /orion/turns` answer. `proposal` is reserved for OR5 (write by
 * proposal + confirmation) and is always `null` here.
 */
export type OrionTurnResponse = {
  text: string;
  card: OrionCard | null;
  uiAction: OrionUiAction | null;
  proposal: null;
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
