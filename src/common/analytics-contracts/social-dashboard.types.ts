import type { ChannelId } from "./social-channels";

/**
 * The persisted dashboard contract (Etapa 5).
 *
 * Separate from `socialAnalytics.types.ts`, which describes what the Meta read
 * model returns. Nothing here is a metric: a dashboard is a saved arrangement,
 * and the two change for entirely different reasons.
 */

export const DASHBOARD_LAYOUT_VERSION = 1;

export type DashboardCardKind =
  | "kpi"
  | "chart"
  | "table"
  /** One distribution metric drawn as buckets — see `AnalyticsBreakdownCard`. */
  | "breakdown"
  | "funnel"
  | "insight"
  /** A sub-block holding cards of its own — see `AnalyticsSubBlock`. */
  | "group";

export type DashboardCardSize = { w: number; h: number };

/**
 * A card as stored. The body varies by kind and is owned by the components that
 * render it (Etapas 6–8); only the envelope is guaranteed here, which is also
 * exactly what the backend validates.
 */
export type SocialDashboardCard = {
  id: string;
  kind: DashboardCardKind;
  size: DashboardCardSize;
  [key: string]: unknown;
};

export type SocialDashboardSection = {
  id: string;
  channel: ChannelId;
  title: string;
  description?: string | null;
  cards: SocialDashboardCard[];
};

export type SocialDashboardLayout = {
  version: typeof DASHBOARD_LAYOUT_VERSION;
  sections: SocialDashboardSection[];
};

export type SocialAnalyticsDashboard = {
  id: string;
  name: string;
  description: string | null;
  /** "Visão Geral": present in every context and not deletable. */
  isDefault: boolean;
  /**
   * The channel this row is the fixed screen for, or null for one the operator
   * created.
   *
   * Sent by the server, never derived here: a dashboard someone built and
   * called "Instagram" has one channel and that name, and treating it as a
   * fixed screen would lock its name and hide its delete option.
   */
  channelKey: ChannelId | null;
  channels: ChannelId[];
  layout: SocialDashboardLayout;
  createdAt: string;
  updatedAt: string;
};

export type SocialAnalyticsDashboardsResponse = {
  items: SocialAnalyticsDashboard[];
  total: number;
};

export type CreateSocialDashboardPayload = {
  name: string;
  channels: ChannelId[];
};

export type UpdateSocialDashboardPayload = {
  name?: string;
  description?: string | null;
  channels?: ChannelId[];
  layout?: SocialDashboardLayout;
};
