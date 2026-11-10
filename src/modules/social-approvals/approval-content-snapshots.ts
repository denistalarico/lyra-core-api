import { type EntityManager, In, IsNull, Not } from 'typeorm';
import {
  SocialCampaignInstanceEntity,
  SocialContentDestinationEntity,
  SocialContentItemEntity,
  SocialDestinationCreativeEntity,
  SocialPlanEntity,
} from '../social-planner/entities';
import type {
  ApprovalTableSnapshotPayload,
  SocialApprovalRequestEntity,
} from './entities';

/** Client-facing by design: `brief` and every internal note stay out. */
const TABLE_COLUMNS: ApprovalTableSnapshotPayload['columns'] = [
  { key: 'plannedDate', label: 'Data' },
  { key: 'title', label: 'Título' },
  { key: 'contentType', label: 'Tipo' },
  { key: 'creativeFormat', label: 'Formato' },
  { key: 'objective', label: 'Objetivo' },
  { key: 'theme', label: 'Tema' },
  { key: 'keyMessage', label: 'Mensagem principal' },
  { key: 'channels', label: 'Canais' },
];

export type ApprovalTableSource = {
  key: string;
  kind: 'plan_table' | 'campaign_table';
  sourceId: string;
};

const text = (value: string | null | undefined) => value?.trim() || null;

const brDate = (value: string | null | undefined) => {
  const [year, month, day] = value?.slice(0, 10).split('-') ?? [];
  return year && month && day ? `${day}/${month}/${year}` : null;
};

const capitalized = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);

const eligible = {
  calendarOnly: false,
  archivedAt: IsNull(),
  deletedAt: IsNull(),
  // `posted` stays in: a published item must not make the approved table stale.
  planningStatus: Not('cancelled' as const),
};

/**
 * D-20/D-11: the table of a plan or campaign as it stands now. The same
 * assembly serves the snapshot and the later comparison against its
 * `content_hash`, and it is batched because the board runs it for every
 * approved table of the contexts it reads.
 */
export async function buildTablePayloads(
  manager: EntityManager,
  sources: readonly ApprovalTableSource[],
): Promise<Map<string, ApprovalTableSnapshotPayload>> {
  const planIds = sources
    .filter((source) => source.kind === 'plan_table')
    .map((source) => source.sourceId);
  const campaignIds = sources
    .filter((source) => source.kind === 'campaign_table')
    .map((source) => source.sourceId);

  const items = await manager.getRepository(SocialContentItemEntity).find({
    where: [
      ...(planIds.length ? [{ ...eligible, planId: In(planIds) }] : []),
      ...(campaignIds.length
        ? [{ ...eligible, campaignInstanceId: In(campaignIds) }]
        : []),
    ],
    order: {
      plannedDate: { direction: 'ASC', nulls: 'LAST' },
      sortOrder: 'ASC',
      id: 'ASC',
    },
  });
  const liveCampaignPlans = campaignIds.length
    ? new Set(
        (
          await manager.getRepository(SocialPlanEntity).find({
            where: {
              id: In([...new Set(items.map((item) => item.planId))]),
              deletedAt: IsNull(),
              status: Not('archived'),
            },
            select: { id: true },
          })
        ).map((plan) => plan.id),
      )
    : new Set<string>();
  const destinations = items.length
    ? await manager.getRepository(SocialContentDestinationEntity).find({
        where: { contentItemId: In(items.map((item) => item.id)) },
      })
    : [];
  const channelsByItem = new Map<string, Set<string>>();
  for (const destination of destinations) {
    const channels =
      channelsByItem.get(destination.contentItemId) ?? new Set<string>();
    channels.add(
      `${capitalized(destination.channel)} · ${capitalized(destination.placement)}`,
    );
    channelsByItem.set(destination.contentItemId, channels);
  }
  const campaigns = campaignIds.length
    ? await manager
        .getRepository(SocialCampaignInstanceEntity)
        .find({ where: { id: In(campaignIds) } })
    : [];
  const campaignById = new Map(campaigns.map((row) => [row.id, row]));

  const rowOf = (item: SocialContentItemEntity) => ({
    plannedDate: brDate(item.plannedDate),
    title: text(item.title),
    contentType: text(item.contentType),
    creativeFormat: text(item.creativeFormat),
    objective: text(item.objective),
    theme: text(item.theme),
    keyMessage: text(item.keyMessage),
    channels:
      [...(channelsByItem.get(item.id) ?? [])].sort().join(', ') || null,
  });

  return new Map(
    sources.map((source) => {
      if (source.kind === 'plan_table')
        return [
          source.key,
          {
            columns: TABLE_COLUMNS,
            rows: items
              .filter((item) => item.planId === source.sourceId)
              .map(rowOf),
          },
        ];
      const campaign = campaignById.get(source.sourceId);
      const period = [brDate(campaign?.startsOn), brDate(campaign?.endsOn)]
        .filter(Boolean)
        .join(' a ');
      return [
        source.key,
        {
          columns: TABLE_COLUMNS,
          rows: items
            .filter(
              (item) =>
                item.campaignInstanceId === source.sourceId &&
                liveCampaignPlans.has(item.planId),
            )
            .map(rowOf),
          summary: [
            { label: 'Campanha', value: text(campaign?.name) },
            { label: 'Objetivo', value: text(campaign?.objective) },
            { label: 'Período', value: period || null },
            { label: 'Descrição', value: text(campaign?.description) },
          ].filter((entry): entry is { label: string; value: string } =>
            Boolean(entry.value),
          ),
        },
      ];
    }),
  );
}

export function tableWarnings(payload: ApprovalTableSnapshotPayload) {
  return {
    itemsWithoutDate: payload.rows.filter((row) => !row.plannedDate).length,
    itemsWithoutTitle: payload.rows.filter((row) => !row.title).length,
  };
}

/**
 * D-23: the media a direct upload left on the item's destinations, one id per
 * file even when the same file serves more than one destination. A carousel
 * and a Story are a single ordered set.
 */
export async function destinationMediaIds(
  manager: EntityManager,
  contentItemIds: readonly string[],
): Promise<Map<string, string[]>> {
  if (contentItemIds.length === 0) return new Map();
  const [creatives, destinations] = await Promise.all([
    manager
      .getRepository(SocialDestinationCreativeEntity)
      .find({ where: { contentItemId: In([...contentItemIds]) } }),
    manager
      .getRepository(SocialContentDestinationEntity)
      .find({ where: { contentItemId: In([...contentItemIds]) } }),
  ]);
  const placementOf = new Map(
    destinations.map((row) => [row.id, `${row.channel}:${row.placement}`]),
  );
  const ordered = [...creatives].sort(
    (a, b) =>
      (placementOf.get(a.destinationId) ?? '').localeCompare(
        placementOf.get(b.destinationId) ?? '',
      ) ||
      Number(b.role === 'primary') - Number(a.role === 'primary') ||
      a.sortOrder - b.sortOrder ||
      a.id.localeCompare(b.id),
  );
  const result = new Map<string, string[]>();
  for (const creative of ordered) {
    const ids = result.get(creative.contentItemId) ?? [];
    if (!ids.includes(creative.mediaAssetId)) ids.push(creative.mediaAssetId);
    result.set(creative.contentItemId, ids);
  }
  return result;
}

/** The formats each file of the item serves, for the tabs of the approval. */
export async function destinationMediaPlacements(
  manager: EntityManager,
  contentItemId: string,
): Promise<Map<string, string[]>> {
  const [creatives, destinations] = await Promise.all([
    manager
      .getRepository(SocialDestinationCreativeEntity)
      .find({ where: { contentItemId } }),
    manager
      .getRepository(SocialContentDestinationEntity)
      .find({ where: { contentItemId } }),
  ]);
  const placementOf = new Map(
    destinations.map((row) => [row.id, row.placement]),
  );
  const result = new Map<string, string[]>();
  for (const creative of creatives) {
    const placement = placementOf.get(creative.destinationId);
    if (!placement) continue;
    const placements = result.get(creative.mediaAssetId) ?? [];
    if (!placements.includes(placement)) placements.push(placement);
    result.set(creative.mediaAssetId, placements);
  }
  return result;
}

/** Only free text is client-editable (D-02); tables, links and files are not. */
export function isTextEditableApproval(
  approval: Pick<SocialApprovalRequestEntity, 'subjectType' | 'displayType'>,
): boolean {
  return (
    approval.subjectType === 'planner_content_revision' ||
    (approval.subjectType === 'approval_snapshot' &&
      approval.displayType === 'text')
  );
}
