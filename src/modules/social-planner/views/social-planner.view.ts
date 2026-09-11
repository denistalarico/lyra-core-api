import {
  SocialContentDestinationEntity,
  SocialContentItemEntity,
  SocialPlanEntity,
  SocialContentRevisionEntity,
} from '../entities';

export function toSocialPlanView(plan: SocialPlanEntity) {
  return {
    id: plan.id,
    title: plan.title,
    periodStart: plan.periodStart,
    periodEnd: plan.periodEnd,
    status: plan.status,
    primaryObjective: plan.primaryObjective,
    strategyMode: plan.strategyMode,
    summary: plan.summary,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

export function toSocialDestinationView(
  destination: SocialContentDestinationEntity,
) {
  return {
    id: destination.id,
    channel: destination.channel,
    placement: destination.placement,
    plannedAt: destination.plannedAt,
    createdAt: destination.createdAt,
    updatedAt: destination.updatedAt,
  };
}

export function toSocialContentItemView(
  item: SocialContentItemEntity,
  destinations: SocialContentDestinationEntity[] = [],
) {
  return {
    id: item.id,
    planId: item.planId,
    title: item.title,
    theme: item.theme,
    brief: item.brief,
    keyMessage: item.keyMessage,
    copy: item.copy,
    caption: item.caption,
    script: item.script,
    cta: item.cta,
    hashtags: item.hashtags,
    firstComment: item.firstComment,
    currentRevisionId: item.currentRevisionId,
    funnelStage: item.funnelStage,
    contentType: item.contentType,
    objective: item.objective,
    creativeFormat: item.creativeFormat,
    planningStatus: item.planningStatus,
    plannedDate: item.plannedDate,
    sortOrder: item.sortOrder,
    campaignInstanceId: item.campaignInstanceId,
    editorialPillarId: item.editorialPillarId,
    destinations: destinations.map(toSocialDestinationView),
    /**
     * Archive state crosses the boundary so the UI can label an archived row
     * and offer Restore instead of Archive (E6).
     *
     * `archivedById` does not, and neither does anything about deletion. The
     * actor is an internal user id the Planner has no screen for, and a
     * soft-deleted item never reaches a view at all — every read filters it
     * out, so exposing `deletedAt` would only ever describe rows the caller
     * cannot see.
     */
    archivedAt: item.archivedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function toSocialContentRevisionView(
  revision: SocialContentRevisionEntity,
) {
  return {
    id: revision.id,
    contentItemId: revision.contentItemId,
    revisionNumber: revision.revisionNumber,

    copy: revision.copy,
    caption: revision.caption,
    script: revision.script,
    cta: revision.cta,
    hashtags: revision.hashtags,
    firstComment: revision.firstComment,

    briefSnapshot: revision.briefSnapshot,

    source: revision.source,
    parentRevisionId: revision.parentRevisionId,
    generationRunId: revision.generationRunId,

    createdAt: revision.createdAt,
  };
}
