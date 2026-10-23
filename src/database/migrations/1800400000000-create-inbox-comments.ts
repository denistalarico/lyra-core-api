import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  PLATFORM_ROLE_KEYS,
  PlatformRoleKey,
} from '../../modules/permissions/enums/permission.enums';
import { getPermissionDefinition } from '../../modules/permissions/catalog/permission-keys.catalog';
import { DEFAULT_ROLE_PERMISSION_MATRIX } from '../../modules/permissions/catalog/role-permission-matrix.catalog';

const PERMISSION_KEYS = [
  'leadflow.inbox.comment.view.client',
  'leadflow.inbox.comment.reply.client',
  'leadflow.inbox.comment.delete.admin',
];

const SCOPE_CHECK = (
  table: string,
) => `CONSTRAINT "CK_${table}_company_scope" CHECK (
        (scope_kind = 'agency' AND agency_client_id IS NULL AND company_context_id IS NULL)
        OR (scope_kind = 'company' AND agency_client_id IS NOT NULL AND company_context_id IS NOT NULL)
        OR (scope_kind = 'legacy_unassigned' AND agency_client_id IS NULL AND company_context_id IS NULL)
      )`;

/**
 * IX3 — post and ad comments in the LeadFlow Inbox.
 *
 * - `inbox_comments`: one row per Meta comment, scoped like
 *   `inbox_conversations` (the same company-scope CHECK), deduplicated by the
 *   provider id per channel so our own replies echoing back stay one row;
 * - `inbox_comment_contents`: the post/ad cache (no `media_url`);
 * - `inbox_comment_agent_actions`: the comment agent's ledger (a comment has
 *   no conversation, so it cannot live in `inbox_governed_actions`);
 * - `social_ad_entities.effective_*`: the story/media an ad renders, so the
 *   Social port can name the ad behind a Facebook comment;
 * - the three `leadflow.inbox.comment.*` permission keys.
 *
 * Additive and idempotent: the PostgreSQL specs run `up()` against a database
 * the runner already migrated.
 */
export class CreateInboxComments1800400000000 implements MigrationInterface {
  name = 'CreateInboxComments1800400000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE IF NOT EXISTS inbox_comments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      workspace_id uuid NOT NULL,
      agency_client_id uuid,
      company_context_id uuid,
      scope_kind varchar(24) NOT NULL,
      channel_id uuid NOT NULL REFERENCES inbox_channels(id) ON DELETE CASCADE,
      surface varchar(16) NOT NULL,
      account_external_id varchar(180) NOT NULL,
      external_comment_id varchar(180) NOT NULL,
      external_parent_id varchar(180),
      external_content_id varchar(180),
      content_kind varchar(16) NOT NULL DEFAULT 'unknown',
      ad_external_id varchar(180),
      ad_title varchar(240),
      author_external_id varchar(180),
      author_username varchar(240),
      author_name varchar(240),
      author_avatar_url text,
      text text,
      direction varchar(16) NOT NULL,
      author_user_id uuid,
      author_agent_id uuid,
      status varchar(16) NOT NULL DEFAULT 'active',
      reply_status varchar(16) NOT NULL DEFAULT 'unanswered',
      private_reply_status varchar(16) NOT NULL DEFAULT 'none',
      private_reply_at timestamptz,
      private_reply_conversation_id uuid,
      provider_created_at timestamptz,
      occurred_at timestamptz NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      idempotency_key varchar(220),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      ${SCOPE_CHECK('inbox_comments')},
      CONSTRAINT "CK_inbox_comments_surface" CHECK (surface IN ('instagram','facebook')),
      CONSTRAINT "CK_inbox_comments_content_kind" CHECK (content_kind IN ('post','reel','story','live','ad','unknown')),
      CONSTRAINT "CK_inbox_comments_direction" CHECK (direction IN ('inbound','outbound')),
      CONSTRAINT "CK_inbox_comments_status" CHECK (status IN ('active','hidden','deleted')),
      CONSTRAINT "CK_inbox_comments_reply_status" CHECK (reply_status IN ('unanswered','answered','ignored')),
      CONSTRAINT "CK_inbox_comments_private_reply_status" CHECK (private_reply_status IN ('none','sent','failed')),
      CONSTRAINT "CK_inbox_comments_metadata" CHECK (jsonb_typeof(metadata) = 'object')
    )`);
    await runner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_comments_external ON inbox_comments(tenant_id, workspace_id, channel_id, external_comment_id)',
    );
    await runner.query(
      'CREATE INDEX IF NOT EXISTS idx_inbox_comments_reply_status ON inbox_comments(tenant_id, workspace_id, reply_status, occurred_at DESC)',
    );
    await runner.query(
      'CREATE INDEX IF NOT EXISTS idx_inbox_comments_content ON inbox_comments(tenant_id, workspace_id, external_content_id)',
    );
    await runner.query(
      'CREATE INDEX IF NOT EXISTS idx_inbox_comments_parent ON inbox_comments(tenant_id, workspace_id, channel_id, external_parent_id)',
    );
    await runner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_comments_idempotency ON inbox_comments(tenant_id, workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL',
    );

    await runner.query(`CREATE TABLE IF NOT EXISTS inbox_comment_contents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      workspace_id uuid NOT NULL,
      channel_id uuid NOT NULL REFERENCES inbox_channels(id) ON DELETE CASCADE,
      external_content_id varchar(180) NOT NULL,
      content_kind varchar(16) NOT NULL DEFAULT 'unknown',
      permalink text,
      caption text,
      thumbnail_url text,
      is_published boolean,
      ad_external_id varchar(180),
      ad_name varchar(400),
      campaign_name varchar(400),
      provider_created_at timestamptz,
      fetched_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CK_inbox_comment_contents_kind" CHECK (content_kind IN ('post','reel','story','live','ad','unknown'))
    )`);
    await runner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_comment_contents_external ON inbox_comment_contents(tenant_id, workspace_id, channel_id, external_content_id)',
    );

    await runner.query(`CREATE TABLE IF NOT EXISTS inbox_comment_agent_actions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      workspace_id uuid NOT NULL,
      agency_client_id uuid,
      company_context_id uuid,
      scope_kind varchar(24) NOT NULL,
      comment_id uuid NOT NULL REFERENCES inbox_comments(id) ON DELETE CASCADE,
      channel_id uuid NOT NULL,
      author_external_id varchar(180),
      external_content_id varchar(180),
      agent_id uuid NOT NULL,
      agent_version_id uuid,
      action_type varchar(40) NOT NULL,
      trigger varchar(24) NOT NULL,
      reason_code varchar(80) NOT NULL,
      policy_version varchar(80) NOT NULL,
      idempotency_key varchar(220) NOT NULL,
      status varchar(16) NOT NULL,
      public_reply_text text,
      application_result jsonb NOT NULL DEFAULT '{}'::jsonb,
      attempts integer NOT NULL DEFAULT 0,
      claimed_at timestamptz,
      applied_at timestamptz,
      failed_at timestamptz,
      error_code varchar(80),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      ${SCOPE_CHECK('inbox_comment_agent_actions')},
      CONSTRAINT "CK_inbox_comment_agent_actions_type" CHECK (action_type IN ('comment_private_reply')),
      CONSTRAINT "CK_inbox_comment_agent_actions_trigger" CHECK (trigger IN ('keywords','ad_referral')),
      CONSTRAINT "CK_inbox_comment_agent_actions_status" CHECK (status IN ('planned','claimed','applied','blocked','failed'))
    )`);
    await runner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_comment_agent_action_idempotency ON inbox_comment_agent_actions(tenant_id, workspace_id, idempotency_key)',
    );
    await runner.query(
      'CREATE INDEX IF NOT EXISTS idx_inbox_comment_agent_actions_queue ON inbox_comment_agent_actions(status, created_at)',
    );
    await runner.query(
      'CREATE INDEX IF NOT EXISTS idx_inbox_comment_agent_actions_author ON inbox_comment_agent_actions(tenant_id, workspace_id, channel_id, author_external_id, external_content_id, created_at DESC)',
    );

    await runner.query(`ALTER TABLE social_ad_entities
      ADD COLUMN IF NOT EXISTS effective_object_story_id varchar(180),
      ADD COLUMN IF NOT EXISTS effective_instagram_media_id varchar(180)`);
    await runner.query(
      'CREATE INDEX IF NOT EXISTS idx_social_ad_entities_story ON social_ad_entities(tenant_id, workspace_id, effective_object_story_id) WHERE effective_object_story_id IS NOT NULL',
    );

    await this.seedPermissions(runner);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DELETE FROM platform_role_permissions
        WHERE permission_key = ANY($1) AND tenant_id IS NULL
          AND role_id IN (SELECT id FROM platform_roles WHERE tenant_id IS NULL AND key = ANY($2))`,
      [PERMISSION_KEYS, Object.values(PlatformRoleKey)],
    );
    await runner.query('DELETE FROM platform_permissions WHERE key = ANY($1)', [
      PERMISSION_KEYS,
    ]);
    await runner.query('DROP INDEX IF EXISTS idx_social_ad_entities_story');
    await runner.query(`ALTER TABLE social_ad_entities
      DROP COLUMN IF EXISTS effective_instagram_media_id,
      DROP COLUMN IF EXISTS effective_object_story_id`);
    await runner.query('DROP TABLE IF EXISTS inbox_comment_agent_actions');
    await runner.query('DROP TABLE IF EXISTS inbox_comment_contents');
    await runner.query('DROP TABLE IF EXISTS inbox_comments');
  }

  /** Same shape as the LeadFlow Automations permission seed (1783700000000). */
  private async seedPermissions(runner: QueryRunner): Promise<void> {
    for (const permissionKey of PERMISSION_KEYS) {
      const definition = getPermissionDefinition(permissionKey);
      if (!definition) {
        throw new Error(`Missing permission definition: ${permissionKey}`);
      }
      await runner.query(
        `INSERT INTO platform_permissions (
           key, product_key, module_key, resource_key, action_key, scope_key,
           risk_level, is_dangerous, is_system
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
         ON CONFLICT (key) DO UPDATE SET
           product_key = EXCLUDED.product_key,
           module_key = EXCLUDED.module_key,
           resource_key = EXCLUDED.resource_key,
           action_key = EXCLUDED.action_key,
           scope_key = EXCLUDED.scope_key,
           risk_level = EXCLUDED.risk_level,
           is_dangerous = EXCLUDED.is_dangerous,
           is_system = true,
           updated_at = now()`,
        [
          definition.key,
          definition.productKey,
          definition.moduleKey,
          definition.resourceKey,
          definition.actionKey,
          definition.scopeKey,
          definition.riskLevel,
          definition.isDangerous,
        ],
      );
    }
    for (const roleKey of PLATFORM_ROLE_KEYS) {
      const [role] = (await runner.query(
        'SELECT id FROM platform_roles WHERE tenant_id IS NULL AND key = $1 LIMIT 1',
        [roleKey],
      )) as Array<{ id: string }>;
      if (!role) continue;
      for (const permissionKey of DEFAULT_ROLE_PERMISSION_MATRIX[roleKey]) {
        if (!PERMISSION_KEYS.includes(permissionKey)) continue;
        await runner.query(
          `INSERT INTO platform_role_permissions (role_id, permission_key, enabled)
           VALUES ($1, $2, true)
           ON CONFLICT (role_id, permission_key) WHERE tenant_id IS NULL DO UPDATE
           SET enabled = true, updated_at = now()`,
          [role.id, permissionKey],
        );
      }
    }
  }
}
