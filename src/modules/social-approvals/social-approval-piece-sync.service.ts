import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  buildTablePayloads,
  destinationMediaIds,
} from './approval-content-snapshots';
import {
  SocialApprovalStepEntity,
  type ApprovalMediaSetSnapshotPayload,
} from './entities';
import {
  hashSnapshotPayload,
  SocialApprovalPiecesService,
} from './social-approval-pieces.service';

export type ApprovalBoardContext = {
  clientId: string | null;
  companyContextId: string | null;
};

const ELIGIBLE_ITEMS = `
  SELECT i.id, i.title, i.plan_id, i.campaign_instance_id,
         p.tenant_id, p.workspace_id, p.agency_client_id, p.company_context_id
    FROM "social_content_items" i
    JOIN "social_plans" p ON p.id = i.plan_id
    JOIN unnest($3::uuid[], $4::uuid[]) AS ctx(client_id, company_id)
      ON p.agency_client_id IS NOT DISTINCT FROM ctx.client_id
     AND p.company_context_id IS NOT DISTINCT FROM ctx.company_id
   WHERE p.tenant_id = $1 AND p.workspace_id = $2
     AND i.calendar_only = false AND i.archived_at IS NULL AND i.deleted_at IS NULL
     AND i.planning_status NOT IN ('cancelled','posted')
     AND p.deleted_at IS NULL AND p.status <> 'archived'`;

const PIECES_IN_CONTEXT = `
  SELECT piece.*
    FROM "social_approval_pieces" piece
    JOIN unnest($3::uuid[], $4::uuid[]) AS ctx(client_id, company_id)
      ON piece.agency_client_id IS NOT DISTINCT FROM ctx.client_id
     AND piece.company_context_id IS NOT DISTINCT FROM ctx.company_id
   WHERE piece.tenant_id = $1 AND piece.workspace_id = $2`;

const INSERT_PIECE = `INSERT INTO "social_approval_pieces"
  ("tenant_id","workspace_id","agency_client_id","company_context_id","kind","source_id","origin","title")`;
const ON_PIECE_CONFLICT = `ON CONFLICT ("kind","source_id") WHERE "source_id" IS NOT NULL DO NOTHING`;

const INSERT_ITEM_PIECES = `${INSERT_PIECE}
  SELECT e.tenant_id, e.workspace_id, e.agency_client_id, e.company_context_id,
         'content_item', e.id, 'social_planner', e.title
    FROM (${ELIGIBLE_ITEMS}) e
  ${ON_PIECE_CONFLICT}`;

const INSERT_PLAN_PIECES = `${INSERT_PIECE}
  SELECT DISTINCT e.tenant_id, e.workspace_id, e.agency_client_id, e.company_context_id,
         'plan_table', p.id, 'social_planner', p.title
    FROM (${ELIGIBLE_ITEMS}) e
    JOIN "social_plans" p ON p.id = e.plan_id
  ${ON_PIECE_CONFLICT}`;

const INSERT_CAMPAIGN_PIECES = `${INSERT_PIECE}
  SELECT DISTINCT c.tenant_id, c.workspace_id, c.agency_client_id, c.company_context_id,
         'campaign_table', c.id, 'social_planner', c.name
    FROM (${ELIGIBLE_ITEMS}) e
    JOIN "social_campaign_instances" c ON c.id = e.campaign_instance_id
   WHERE c.status IN ('planned','active')
     AND c.tenant_id = e.tenant_id AND c.workspace_id = e.workspace_id
     AND c.agency_client_id IS NOT DISTINCT FROM e.agency_client_id
     AND c.company_context_id IS NOT DISTINCT FROM e.company_context_id
  ${ON_PIECE_CONFLICT}`;

const INSERT_STEPS = `INSERT INTO "social_approval_steps"
    ("tenant_id","workspace_id","agency_client_id","company_context_id","piece_id","kind","position","title")
  SELECT piece.tenant_id, piece.workspace_id, piece.agency_client_id, piece.company_context_id,
         piece.id, step.kind, step.position, step.title
    FROM (${PIECES_IN_CONTEXT}) piece
    JOIN (VALUES
      ('content_item','copy',0,'Copy'),
      ('content_item','creative',1,'Criativo'),
      ('plan_table','table',0,'Tabela'),
      ('campaign_table','table',0,'Tabela')
    ) AS step(piece_kind, kind, position, title) ON step.piece_kind = piece.kind
   WHERE NOT EXISTS (
     SELECT 1 FROM "social_approval_steps" existing
      WHERE existing.piece_id = piece.id AND existing.kind = step.kind
   )
  ON CONFLICT ("piece_id","kind") WHERE "kind" IN ('table','copy','creative') DO NOTHING`;

/** What each sourced piece should look like right now (D-31). */
const SOURCE_FACTS = `
  SELECT piece.id,
         CASE
           WHEN i.planning_status = 'posted' THEN 'posted'
           WHEN i.id IS NULL OR i.archived_at IS NOT NULL OR i.deleted_at IS NOT NULL
             OR i.planning_status = 'cancelled' OR p.deleted_at IS NOT NULL OR p.status = 'archived'
             THEN 'hidden'
           ELSE 'active'
         END AS state,
         COALESCE(i.title, piece.title) AS title
    FROM (${PIECES_IN_CONTEXT}) piece
    LEFT JOIN "social_content_items" i ON i.id = piece.source_id
    LEFT JOIN "social_plans" p ON p.id = i.plan_id
   WHERE piece.kind = 'content_item'
  UNION ALL
  SELECT piece.id,
         CASE
           WHEN p.id IS NOT NULL AND p.deleted_at IS NULL AND p.status <> 'archived' AND EXISTS (
             SELECT 1 FROM "social_content_items" i
              WHERE i.plan_id = p.id AND i.calendar_only = false AND i.archived_at IS NULL
                AND i.deleted_at IS NULL AND i.planning_status NOT IN ('cancelled','posted')
           ) THEN 'active'
           ELSE 'hidden'
         END,
         COALESCE(p.title, piece.title)
    FROM (${PIECES_IN_CONTEXT}) piece
    LEFT JOIN "social_plans" p ON p.id = piece.source_id
   WHERE piece.kind = 'plan_table'
  UNION ALL
  SELECT piece.id,
         CASE
           WHEN c.id IS NOT NULL AND c.status IN ('planned','active') AND EXISTS (
             SELECT 1 FROM "social_content_items" i
              JOIN "social_plans" p ON p.id = i.plan_id
              WHERE i.campaign_instance_id = c.id AND i.calendar_only = false
                AND i.archived_at IS NULL AND i.deleted_at IS NULL
                AND i.planning_status NOT IN ('cancelled','posted')
                AND p.deleted_at IS NULL AND p.status <> 'archived'
           ) THEN 'active'
           ELSE 'hidden'
         END,
         COALESCE(c.name, piece.title)
    FROM (${PIECES_IN_CONTEXT}) piece
    LEFT JOIN "social_campaign_instances" c ON c.id = piece.source_id
   WHERE piece.kind = 'campaign_table'`;

const UPDATE_SOURCE_STATE = `UPDATE "social_approval_pieces" piece
    SET "source_state" = facts.state, "title" = LEFT(facts.title, 255), "updated_at" = now()
   FROM (${SOURCE_FACTS}) facts
  WHERE piece.id = facts.id
    AND (piece.source_state IS DISTINCT FROM facts.state
         OR piece.title IS DISTINCT FROM LEFT(facts.title, 255))
  RETURNING piece.id`;

const UNPROJECTED = `SELECT piece.id FROM (${PIECES_IN_CONTEXT}) piece WHERE piece.active_step_id IS NULL`;

/** Approved snapshots whose source can still change under them (D-20). */
const APPROVED_SNAPSHOT_STEPS = `
  SELECT step.id AS step_id, step.is_stale, step.piece_id, step.current_request_id,
         step.tenant_id, step.workspace_id, step.agency_client_id, step.company_context_id,
         piece.kind AS piece_kind, piece.source_id,
         snapshot.kind AS snapshot_kind, snapshot.payload, snapshot.content_hash
    FROM (${PIECES_IN_CONTEXT}) piece
    JOIN "social_approval_steps" step ON step.piece_id = piece.id
    JOIN "social_approval_requests" request ON request.id = step.current_request_id
    JOIN "social_approval_snapshots" snapshot ON snapshot.id = request.subject_revision_id
   WHERE piece.source_id IS NOT NULL AND piece.source_state = 'active' AND piece.finished_at IS NULL
     AND request.status = 'approved' AND request.subject_type = 'approval_snapshot'
     AND snapshot.kind IN ('table','media_set')`;

type ApprovedSnapshotRow = {
  step_id: string;
  is_stale: boolean;
  piece_id: string;
  current_request_id: string;
  tenant_id: string;
  workspace_id: string;
  agency_client_id: string | null;
  company_context_id: string | null;
  piece_kind: 'plan_table' | 'campaign_table' | 'content_item';
  source_id: string;
  snapshot_kind: 'table' | 'media_set';
  payload: unknown;
  content_hash: string;
};

/**
 * D-31 — Planner pieces are born here, before a board is read, instead of
 * from a hook in each of the Planner's creation paths. Single idempotent
 * statements over the contexts being read, so repeating it is a no-op. It
 * records no events: appearing on the board is not a decision.
 */
@Injectable()
export class SocialApprovalPieceSyncService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly pieces: SocialApprovalPiecesService,
  ) {}

  async syncContexts(
    scope: { tenantId: string; workspaceId: string },
    contexts: readonly ApprovalBoardContext[],
  ): Promise<void> {
    if (contexts.length === 0) return;
    const parameters = this.parameters(scope, contexts);
    for (const statement of [
      INSERT_ITEM_PIECES,
      INSERT_PLAN_PIECES,
      INSERT_CAMPAIGN_PIECES,
      INSERT_STEPS,
    ])
      await this.dataSource.query(statement, parameters);

    const [changed] = await this.dataSource.query<
      [Array<{ id: string }>, number]
    >(UPDATE_SOURCE_STATE, parameters);
    const unprojected = await this.dataSource.query<Array<{ id: string }>>(
      UNPROJECTED,
      parameters,
    );
    await this.pieces.recomputeMany([
      ...new Set([
        ...changed.map((row) => row.id),
        ...unprojected.map((row) => row.id),
        ...(await this.refreshSnapshotStaleness(parameters)),
      ]),
    ]);
  }

  /** D-20 for one context, without the rest of the sync (the send screens). */
  async refreshStaleness(
    scope: { tenantId: string; workspaceId: string },
    contexts: readonly ApprovalBoardContext[],
  ): Promise<void> {
    await this.pieces.recomputeMany(
      await this.refreshSnapshotStaleness(this.parameters(scope, contexts)),
    );
  }

  private parameters(
    scope: { tenantId: string; workspaceId: string },
    contexts: readonly ApprovalBoardContext[],
  ) {
    return [
      scope.tenantId,
      scope.workspaceId,
      contexts.map((context) => context.clientId),
      contexts.map((context) => context.companyContextId),
    ];
  }

  /**
   * The Planner has many write paths for items (the reason for D-31 itself),
   * so tables and direct uploads are compared with their approved snapshot
   * when read, not hooked on each path. Returns the pieces that flipped.
   */
  private async refreshSnapshotStaleness(
    parameters: unknown[],
  ): Promise<string[]> {
    const rows = await this.dataSource.query<ApprovedSnapshotRow[]>(
      APPROVED_SNAPSHOT_STEPS,
      parameters,
    );
    if (rows.length === 0) return [];
    const manager = this.dataSource.manager;
    const tableRows = rows.filter((row) => row.snapshot_kind === 'table');
    const [tables, media] = await Promise.all([
      buildTablePayloads(
        manager,
        tableRows.map((row) => ({
          key: row.step_id,
          kind: row.piece_kind as 'plan_table' | 'campaign_table',
          sourceId: row.source_id,
        })),
      ),
      destinationMediaIds(
        manager,
        rows
          .filter((row) => row.snapshot_kind === 'media_set')
          .map((row) => row.source_id),
      ),
    ]);
    const flipped: string[] = [];
    for (const row of rows) {
      const isStale =
        row.snapshot_kind === 'table'
          ? hashSnapshotPayload(tables.get(row.step_id)!) !== row.content_hash
          : (media.get(row.source_id) ?? []).join() !==
            (row.payload as ApprovalMediaSetSnapshotPayload).items
              .map((item) => item.mediaAssetId)
              .join();
      if (isStale === row.is_stale) continue;
      await manager.update(SocialApprovalStepEntity, row.step_id, { isStale });
      if (isStale)
        await this.pieces.recordEvent(
          manager,
          {
            tenantId: row.tenant_id,
            workspaceId: row.workspace_id,
            agencyClientId: row.agency_client_id,
            companyContextId: row.company_context_id,
            pieceId: row.piece_id,
            stepId: row.step_id,
            requestId: row.current_request_id,
          },
          'reopened_stale',
        );
      flipped.push(row.piece_id);
    }
    return flipped;
  }
}
