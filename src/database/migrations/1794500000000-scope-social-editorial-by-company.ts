import type { MigrationInterface, QueryRunner } from 'typeorm';

const ROOTS = [
  'social_plans',
  'social_campaign_templates',
  'social_campaign_instances',
  'social_content_ideas',
  'social_planner_settings',
  'social_editorial_pillars',
  'social_publishing_cadences',
] as const;

export class ScopeSocialEditorialByCompany1794500000000 implements MigrationInterface {
  name = 'ScopeSocialEditorialByCompany1794500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_agency_client_company_contexts_operational_scope"
      ON "agency_client_company_contexts"
        ("id", "tenant_id", "workspace_id", "agency_client_id")
    `);

    for (const table of ROOTS) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "company_context_id" uuid`,
      );
      await queryRunner.query(`
        WITH candidates AS (
          SELECT "tenant_id", "workspace_id", "agency_client_id",
                 (array_agg("id" ORDER BY "id"))[1] AS "company_context_id",
                 count(*) AS "context_count"
          FROM "agency_client_company_contexts"
          GROUP BY "tenant_id", "workspace_id", "agency_client_id"
        )
        UPDATE "${table}" AS root
        SET "company_context_id" = candidates."company_context_id"
        FROM candidates
        WHERE root."company_context_id" IS NULL
          AND root."agency_client_id" IS NOT NULL
          AND candidates."tenant_id" = root."tenant_id"
          AND candidates."workspace_id" = root."workspace_id"
          AND candidates."agency_client_id" = root."agency_client_id"
          AND candidates."context_count" = 1
      `);
      await queryRunner.query(`
        ALTER TABLE "${table}"
          DROP CONSTRAINT IF EXISTS "CK_${table}_company_scope",
          ADD CONSTRAINT "CK_${table}_company_scope"
            CHECK ("company_context_id" IS NULL OR "agency_client_id" IS NOT NULL),
          DROP CONSTRAINT IF EXISTS "FK_${table}_company_context",
          ADD CONSTRAINT "FK_${table}_company_context"
            FOREIGN KEY (
              "company_context_id", "tenant_id", "workspace_id", "agency_client_id"
            )
            REFERENCES "agency_client_company_contexts" (
              "id", "tenant_id", "workspace_id", "agency_client_id"
            )
            ON DELETE RESTRICT
      `);
    }

    await this.replaceScopeIndexes(queryRunner, true);
    await this.replaceUniqueIndexes(queryRunner, true);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await this.replaceUniqueIndexes(queryRunner, false);
    await this.replaceScopeIndexes(queryRunner, false);

    for (const table of [...ROOTS].reverse()) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
          DROP CONSTRAINT IF EXISTS "FK_${table}_company_context",
          DROP CONSTRAINT IF EXISTS "CK_${table}_company_scope",
          DROP COLUMN IF EXISTS "company_context_id"
      `);
    }

    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_agency_client_company_contexts_operational_scope"',
    );
  }

  private async replaceScopeIndexes(
    queryRunner: QueryRunner,
    companyAware: boolean,
  ): Promise<void> {
    const company = companyAware ? ', "company_context_id"' : '';
    const definitions = [
      ['IDX_social_plans_scope', 'social_plans', ''],
      [
        'IDX_social_plans_period',
        'social_plans',
        ', "period_start", "period_end"',
      ],
      ['IDX_social_campaign_templates_scope', 'social_campaign_templates', ''],
      ['IDX_social_campaign_instances_scope', 'social_campaign_instances', ''],
      [
        'IDX_social_campaign_instances_period',
        'social_campaign_instances',
        ', "starts_on", "ends_on"',
      ],
      ['IDX_social_content_ideas_scope', 'social_content_ideas', ''],
      [
        'IDX_social_content_ideas_backlog',
        'social_content_ideas',
        ', "status", "priority"',
      ],
      ['IDX_social_planner_settings_scope', 'social_planner_settings', ''],
      ['IDX_social_editorial_pillars_scope', 'social_editorial_pillars', ''],
      [
        'IDX_social_publishing_cadences_scope',
        'social_publishing_cadences',
        '',
      ],
    ] as const;

    for (const [name, table, suffix] of definitions) {
      await queryRunner.query(`DROP INDEX IF EXISTS "${name}"`);
      await queryRunner.query(`
        CREATE INDEX "${name}" ON "${table}"
          ("tenant_id", "workspace_id", "agency_client_id"${company}${suffix})
      `);
    }
  }

  private async replaceUniqueIndexes(
    queryRunner: QueryRunner,
    companyAware: boolean,
  ): Promise<void> {
    const namedRoots = [
      ['social_campaign_templates', 'name'],
      ['social_campaign_instances', 'name'],
      ['social_editorial_pillars', 'key'],
    ] as const;

    for (const [table, field] of namedRoots) {
      const prefix =
        table === 'social_campaign_templates'
          ? 'social_campaign_templates'
          : table === 'social_campaign_instances'
            ? 'social_campaign_instances'
            : 'social_editorial_pillars';
      const oldName = `UQ_${prefix}_client_${field}`;
      const companyName = `UQ_${prefix}_company_${field}`;
      const legacyName = `UQ_${prefix}_legacy_${field}`;
      await queryRunner.query(`DROP INDEX IF EXISTS "${oldName}"`);
      await queryRunner.query(`DROP INDEX IF EXISTS "${companyName}"`);
      await queryRunner.query(`DROP INDEX IF EXISTS "${legacyName}"`);

      if (companyAware) {
        await queryRunner.query(`
          CREATE UNIQUE INDEX "${companyName}" ON "${table}"
            ("tenant_id", "workspace_id", "agency_client_id", "company_context_id", "${field}")
          WHERE "company_context_id" IS NOT NULL
        `);
        await queryRunner.query(`
          CREATE UNIQUE INDEX "${legacyName}" ON "${table}"
            ("tenant_id", "workspace_id", "agency_client_id", "${field}")
          WHERE "agency_client_id" IS NOT NULL AND "company_context_id" IS NULL
        `);
      } else {
        await queryRunner.query(`
          CREATE UNIQUE INDEX "${oldName}" ON "${table}"
            ("tenant_id", "workspace_id", "agency_client_id", "${field}")
          WHERE "agency_client_id" IS NOT NULL
        `);
      }
    }

    for (const table of [
      'social_planner_settings',
      'social_publishing_cadences',
    ] as const) {
      const oldName = `UQ_${table}_client_scope`;
      const companyName = `UQ_${table}_company_scope`;
      const legacyName = `UQ_${table}_legacy_scope`;
      await queryRunner.query(`DROP INDEX IF EXISTS "${oldName}"`);
      await queryRunner.query(`DROP INDEX IF EXISTS "${companyName}"`);
      await queryRunner.query(`DROP INDEX IF EXISTS "${legacyName}"`);

      if (companyAware) {
        await queryRunner.query(`
          CREATE UNIQUE INDEX "${companyName}" ON "${table}"
            ("tenant_id", "workspace_id", "agency_client_id", "company_context_id")
          WHERE "company_context_id" IS NOT NULL
        `);
        await queryRunner.query(`
          CREATE UNIQUE INDEX "${legacyName}" ON "${table}"
            ("tenant_id", "workspace_id", "agency_client_id")
          WHERE "agency_client_id" IS NOT NULL AND "company_context_id" IS NULL
        `);
      } else {
        await queryRunner.query(`
          CREATE UNIQUE INDEX "${oldName}" ON "${table}"
            ("tenant_id", "workspace_id", "agency_client_id")
          WHERE "agency_client_id" IS NOT NULL
        `);
      }
    }
  }
}
