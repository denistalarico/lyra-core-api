import type { SocialBoostTemplateEntity } from '../entities';

/** Authorized projection: scope and actor ids never leave the server. */
export function toSocialBoostTemplateView(row: SocialBoostTemplateEntity) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    objective: row.objective,
    performanceGoal: row.performanceGoal,
    conversionLocation: row.conversionLocation,
    conversionEvent: row.conversionEvent,
    budgetType: row.budgetType,
    budgetAmountMinor: row.budgetAmountMinor,
    currency: row.currency,
    durationDays: row.durationDays,
    audienceMode: row.audienceMode,
    audience: row.audience,
    placements: row.placements,
    specialAdCategories: row.specialAdCategories,
    callToAction: row.callToAction,
    destinationUrl: row.destinationUrl,
    messageDestinations: row.messageDestinations,
    isDefault: row.isDefault,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
