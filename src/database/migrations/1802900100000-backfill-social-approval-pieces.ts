import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Which piece and step each legacy request belongs to. */
const REQUEST_TARGETS = `
  SELECT r.id AS request_id, r.tenant_id, r.workspace_id, r.agency_client_id, r.company_context_id,
         r.title, r.created_at,
         CASE
           WHEN r.subject_type = 'planner_content_revision' THEN 'content_item'
           WHEN a.content_item_id IS NOT NULL AND i.id IS NOT NULL THEN 'content_item'
           ELSE 'standalone'
         END AS piece_kind,
         CASE
           WHEN r.subject_type = 'planner_content_revision' THEN r.subject_id
           WHEN a.content_item_id IS NOT NULL AND i.id IS NOT NULL THEN a.content_item_id
         END AS source_id,
         CASE WHEN r.subject_type = 'planner_content_revision' THEN 'copy' ELSE 'creative' END AS step_kind,
         md5('approval-backfill:' || r.subject_type || ':' || r.subject_id::text)::uuid AS standalone_piece_id
    FROM "social_approval_requests" r
    LEFT JOIN "social_creative_assets" a ON r.subject_type = 'creative_version' AND a.id = r.subject_id
    LEFT JOIN "social_content_items" i ON i.id = a.content_item_id
   WHERE r.subject_type IN ('planner_content_revision','creative_version')`;

const STEP_OF_REQUEST = `
  SELECT t.request_id, s.id AS step_id, s.piece_id
    FROM (${REQUEST_TARGETS}) t
    JOIN "social_approval_pieces" p
      ON (t.piece_kind = 'content_item' AND p.kind = 'content_item' AND p.source_id = t.source_id)
      OR (t.piece_kind = 'standalone' AND p.id = t.standalone_piece_id)
    JOIN "social_approval_steps" s ON s.piece_id = p.id AND s.kind = t.step_kind`;

const ACTOR_NAME = (alias: string) => `(
  SELECT NULLIF(btrim(profile.display_name), '')
    FROM "user_profile" profile
   WHERE profile.tenant_id = r.tenant_id AND profile.user_id = ${alias}.actor_user_id
   LIMIT 1
)`;

const SCOPE_SELECT = `r.tenant_id, r.workspace_id, r.agency_client_id, r.company_context_id`;
const EVENT_COLUMNS = `"id","tenant_id","workspace_id","agency_client_id","company_context_id","piece_id","step_id","request_id","type","actor_type","actor_user_id","actor_name","surface","metadata","created_at"`;

/**
 * AR1 — gives every existing approval a piece and a step, derives `resolution`
 * and writes its history as events. Idempotent: pieces and steps conflict on
 * their natural keys, and events take a deterministic id from their source
 * row. `board_column` is left to the first board read, which projects every
 * piece whose `active_step_id` is still NULL through the same code as a live
 * transition, so the rule exists in one place only.
 */
export class BackfillSocialApprovalPieces1802900100000 implements MigrationInterface {
  name = 'BackfillSocialApprovalPieces1802900100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "social_approval_pieces"
        ("tenant_id","workspace_id","agency_client_id","company_context_id","kind","source_id","origin","title")
      SELECT DISTINCT ON (t.source_id)
             t.tenant_id, t.workspace_id, t.agency_client_id, t.company_context_id,
             'content_item', t.source_id, 'social_planner', COALESCE(i.title, t.title)
        FROM (${REQUEST_TARGETS}) t
        LEFT JOIN "social_content_items" i ON i.id = t.source_id
       WHERE t.piece_kind = 'content_item'
       ORDER BY t.source_id, t.created_at DESC
      ON CONFLICT ("kind","source_id") WHERE "source_id" IS NOT NULL DO NOTHING`);

    await queryRunner.query(`
      INSERT INTO "social_approval_pieces"
        ("id","tenant_id","workspace_id","agency_client_id","company_context_id","kind","source_id","origin","title")
      SELECT DISTINCT ON (t.standalone_piece_id)
             t.standalone_piece_id, t.tenant_id, t.workspace_id, t.agency_client_id, t.company_context_id,
             'standalone', NULL, 'approvals', t.title
        FROM (${REQUEST_TARGETS}) t
       WHERE t.piece_kind = 'standalone'
       ORDER BY t.standalone_piece_id, t.created_at DESC
      ON CONFLICT ("id") DO NOTHING`);

    await queryRunner.query(`
      INSERT INTO "social_approval_steps"
        ("tenant_id","workspace_id","agency_client_id","company_context_id","piece_id","kind","position","title")
      SELECT p.tenant_id, p.workspace_id, p.agency_client_id, p.company_context_id, p.id, step.kind, step.position, step.title
        FROM "social_approval_pieces" p
        CROSS JOIN (VALUES ('copy', 0, 'Copy'), ('creative', 1, 'Criativo')) AS step(kind, position, title)
       WHERE p.kind = 'content_item'
      ON CONFLICT ("piece_id","kind") WHERE "kind" IN ('table','copy','creative') DO NOTHING`);

    await queryRunner.query(`
      INSERT INTO "social_approval_steps"
        ("tenant_id","workspace_id","agency_client_id","company_context_id","piece_id","kind","position","title")
      SELECT p.tenant_id, p.workspace_id, p.agency_client_id, p.company_context_id, p.id, 'creative', 0, 'Criativo'
        FROM "social_approval_pieces" p
       WHERE p.kind = 'standalone' AND p.origin = 'approvals'
         AND p.id IN (SELECT t.standalone_piece_id FROM (${REQUEST_TARGETS}) t WHERE t.piece_kind = 'standalone')
      ON CONFLICT ("piece_id","kind") WHERE "kind" IN ('table','copy','creative') DO NOTHING`);

    await queryRunner.query(`
      UPDATE "social_approval_requests" r
         SET "step_id" = target.step_id
        FROM (${STEP_OF_REQUEST}) target
       WHERE r.id = target.request_id AND r.step_id IS NULL`);

    await queryRunner.query(`
      UPDATE "social_approval_steps" s
         SET "current_request_id" = latest.id
        FROM (
          SELECT DISTINCT ON (r.step_id) r.step_id, r.id
            FROM "social_approval_requests" r
           WHERE r.step_id IS NOT NULL
           ORDER BY r.step_id,
                    CASE WHEN r.status IN ('draft','awaiting_internal_review','awaiting_client','changes_requested') THEN 0 ELSE 1 END,
                    r.created_at DESC, r.id DESC
        ) latest
       WHERE s.id = latest.step_id AND s.current_request_id IS DISTINCT FROM latest.id`);

    await queryRunner.query(`
      UPDATE "social_approval_requests" r
         SET "resolution" = CASE
           WHEN EXISTS (
             SELECT 1 FROM "social_approval_stage_decisions" d
              WHERE d.approval_request_id = r.id AND d.stage = 'client' AND d.decision = 'approved'
           ) THEN 'client_approved'
           WHEN r.agency_client_id IS NULL THEN 'internal_final'
         END
       WHERE r.status = 'approved' AND r.resolution IS NULL`);

    await queryRunner.query(`
      INSERT INTO "social_approval_events" (${EVENT_COLUMNS})
      SELECT md5('approval-event:decision:' || d.id::text)::uuid, ${SCOPE_SELECT}, s.piece_id, s.id, r.id,
             d.decision, d.actor_type, d.actor_user_id, ${ACTOR_NAME('d')},
             CASE WHEN d.stage = 'client' THEN 'client_area' ELSE 'agency' END,
             jsonb_build_object('stage', d.stage, 'backfilled', true), d.created_at
        FROM "social_approval_stage_decisions" d
        JOIN "social_approval_requests" r ON r.id = d.approval_request_id
        JOIN "social_approval_steps" s ON s.id = r.step_id
      ON CONFLICT ("id") DO NOTHING`);

    await queryRunner.query(`
      INSERT INTO "social_approval_events" (${EVENT_COLUMNS})
      SELECT md5('approval-event:comment:' || c.id::text)::uuid, ${SCOPE_SELECT}, s.piece_id, s.id, r.id,
             'commented', c.actor_type, c.actor_user_id, ${ACTOR_NAME('c')},
             CASE WHEN c.stage = 'client' AND c.visibility = 'client' THEN 'client_area' ELSE 'agency' END,
             jsonb_build_object('visibility', c.visibility, 'commentId', c.id, 'backfilled', true), c.created_at
        FROM "social_approval_comments" c
        JOIN "social_approval_requests" r ON r.id = c.approval_request_id
        JOIN "social_approval_steps" s ON s.id = r.step_id
      ON CONFLICT ("id") DO NOTHING`);

    for (const [type, column] of [
      ['sent', 'sent_to_client_at'],
      ['cancelled', 'cancelled_at'],
      ['superseded', 'superseded_at'],
    ] as const) {
      await queryRunner.query(`
        INSERT INTO "social_approval_events" (${EVENT_COLUMNS})
        SELECT md5('approval-event:${type}:' || r.id::text)::uuid, ${SCOPE_SELECT}, s.piece_id, s.id, r.id,
               '${type}', 'system', NULL, NULL, 'system', jsonb_build_object('backfilled', true), r.${column}
          FROM "social_approval_requests" r
          JOIN "social_approval_steps" s ON s.id = r.step_id
         WHERE r.${column} IS NOT NULL
        ON CONFLICT ("id") DO NOTHING`);
    }
  }

  /**
   * Nothing to undo: the rows are derived, and dropping the tables is the
   * previous migration's `down`, which refuses once history exists.
   */
  async down(): Promise<void> {}
}
