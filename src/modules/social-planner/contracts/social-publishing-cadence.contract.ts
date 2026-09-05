export interface SocialPublishingCadenceSlot {
  /**
   * 0 = Sunday, 1 = Monday, ... 6 = Saturday.
   */
  dayOfWeek: number;

  /**
   * Local clock time in HH:MM.
   * Interpretation always uses the cadence timezone.
   */
  time: string;
}

export interface SocialPublishingCadenceChannel {
  channel: string;
  enabled: boolean;

  /**
   * NULL means "inherit Planner monthlyContentVolume".
   * A number is an explicit channel-level override.
   */
  frequencyPerMonth: number | null;

  slots: SocialPublishingCadenceSlot[];
}

export interface SocialPublishingCadence {
  timezone: string;
  autoDistributionEnabled: boolean;
  channels: SocialPublishingCadenceChannel[];
}
