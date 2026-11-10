import type { EntityManager } from 'typeorm';
import {
  SocialContentDestinationEntity,
  SocialContentItemEntity,
} from '../social-planner/entities';
import type { SocialApprovalPieceEntity } from './entities';

/** Field by field: this object also reaches the client. */
export type ApprovalPiecePost = {
  contentType: string | null;
  creativeFormat: string | null;
  plannedDate: string | null;
  plannedAt: string | null;
  destinations: Array<{ channel: string; placement: string }>;
};

/** Planning facts of a Planner piece, read live: they are not what is approved. */
export async function approvalPiecePost(
  manager: EntityManager,
  piece: Pick<SocialApprovalPieceEntity, 'kind' | 'sourceId'>,
): Promise<ApprovalPiecePost | null> {
  if (piece.kind !== 'content_item' || !piece.sourceId) return null;
  const [item, destinations] = await Promise.all([
    manager.findOne(SocialContentItemEntity, {
      where: { id: piece.sourceId },
    }),
    manager.find(SocialContentDestinationEntity, {
      where: { contentItemId: piece.sourceId },
    }),
  ]);
  if (!item) return null;
  const plannedAt =
    destinations
      .map((destination) => destination.plannedAt?.toISOString())
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null;
  return {
    contentType: item.contentType,
    creativeFormat: item.creativeFormat,
    plannedDate: item.plannedDate,
    plannedAt,
    destinations: destinations.map((destination) => ({
      channel: destination.channel,
      placement: destination.placement,
    })),
  };
}
