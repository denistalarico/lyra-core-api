import type {
  SocialCampaignInstanceEntity,
  SocialCampaignTemplateEntity,
  SocialContentIdeaEntity,
  SocialEditorialPillarEntity,
} from '../entities';

/**
 * Authorized projections for the E5 objects.
 *
 * Every one of these drops tenantId, workspaceId and agencyClientId. The
 * caller already knows its own context, and echoing the scope back is how a
 * client id leaks into a UI that then starts sending it.
 */

export function toSocialCampaignTemplateView(
  template: SocialCampaignTemplateEntity,
) {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    objective: template.objective,
    defaultDurationDays: template.defaultDurationDays,
    recommendedPillars: template.recommendedPillars,
    isActive: template.isActive,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

export function toSocialCampaignView(campaign: SocialCampaignInstanceEntity) {
  return {
    id: campaign.id,
    templateId: campaign.templateId,
    name: campaign.name,
    description: campaign.description,
    objective: campaign.objective,
    startsOn: campaign.startsOn,
    endsOn: campaign.endsOn,
    status: campaign.status,
    color: campaign.color,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
  };
}

/**
 * `targetPercentage` arrives from the numeric column as a string. It is
 * converted here rather than in the entity so the value the API returns is a
 * number every consumer can compare, and an unparseable value degrades to null
 * instead of shipping "NaN" to a coverage calculation.
 */
export function toSocialEditorialPillarView(
  pillar: SocialEditorialPillarEntity,
) {
  const target =
    pillar.targetPercentage === null ? null : Number(pillar.targetPercentage);

  return {
    id: pillar.id,
    key: pillar.key,
    label: pillar.label,
    description: pillar.description,
    targetPercentage:
      target !== null && Number.isFinite(target) ? target : null,
    color: pillar.color,
    sortOrder: pillar.sortOrder,
    isActive: pillar.isActive,
    createdAt: pillar.createdAt,
    updatedAt: pillar.updatedAt,
  };
}

export function toSocialContentIdeaView(idea: SocialContentIdeaEntity) {
  return {
    id: idea.id,
    title: idea.title,
    notes: idea.notes,
    pillarId: idea.pillarId,
    campaignInstanceId: idea.campaignInstanceId,
    funnelStage: idea.funnelStage,
    contentType: idea.contentType,
    status: idea.status,
    priority: idea.priority,
    source: idea.source,
    convertedContentItemId: idea.convertedContentItemId,
    convertedAt: idea.convertedAt,
    createdAt: idea.createdAt,
    updatedAt: idea.updatedAt,
  };
}
