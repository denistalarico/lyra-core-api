import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Settings > Users (Etapa 3) — the Client Area has Owner, Manager and Member.
 * Member is the `operator` level (acts on what is theirs); the read-only
 * `viewer` level is no longer offered nor accepted on write, so the rows and
 * defaults that still carry it become `operator`. Not reversible: the old
 * read-only choice is not recorded anywhere else.
 */
export class FoldClientAreaViewerIntoMember1802200000000
  implements MigrationInterface
{
  name = 'FoldClientAreaViewerIntoMember1802200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE client_area_member_module_access SET level = 'operator' WHERE level = 'viewer'`,
    );
    await queryRunner.query(
      `UPDATE client_area_invitations
          SET module_levels = (
            SELECT COALESCE(jsonb_object_agg(
                     entry.key,
                     CASE WHEN entry.value = '"viewer"'::jsonb
                          THEN '"operator"'::jsonb ELSE entry.value END
                   ), '{}'::jsonb)
              FROM jsonb_each(module_levels) AS entry
          )
        WHERE module_levels::text LIKE '%"viewer"%'`,
    );
    await queryRunner.query(
      `UPDATE client_area_company_settings
          SET module_settings = (
            SELECT COALESCE(jsonb_object_agg(
                     entry.key,
                     CASE WHEN entry.value->>'defaultLevel' = 'viewer'
                          THEN jsonb_set(entry.value, '{defaultLevel}', '"operator"'::jsonb)
                          ELSE entry.value END
                   ), '{}'::jsonb)
              FROM jsonb_each(module_settings) AS entry
          )
        WHERE module_settings::text LIKE '%"viewer"%'`,
    );
  }

  public async down(): Promise<void> {
    // Irreversible by design (see above).
  }
}
