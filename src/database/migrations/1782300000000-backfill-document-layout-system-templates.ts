import { MigrationInterface, QueryRunner } from 'typeorm';
import { systemDocumentLayoutTemplates } from '../../modules/document-layouts/document-layout-system-templates';

export class BackfillDocumentLayoutSystemTemplates1782300000000
  implements MigrationInterface
{
  name = 'BackfillDocumentLayoutSystemTemplates1782300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const template of systemDocumentLayoutTemplates) {
      await queryRunner.query(
        `
          INSERT INTO "document_layout_templates" (
            "name",
            "type",
            "document_type",
            "html_template",
            "css_template",
            "preview_data",
            "is_system",
            "is_default",
            "metadata"
          )
          SELECT
            $1::varchar,
            $2::varchar,
            'quote'::varchar,
            $3::text,
            $4::text,
            $5::jsonb,
            true,
            $6::boolean,
            $7::jsonb
          WHERE NOT EXISTS (
            SELECT 1 FROM "document_layout_templates"
            WHERE "type" = $2::varchar
              AND "document_type" = 'quote'
              AND "is_system" = true
          );
        `,
        [
          template.name,
          template.type,
          template.htmlTemplate,
          template.cssTemplate,
          JSON.stringify(template.previewData),
          template.isDefault,
          JSON.stringify({ ...template.metadata, multiDocVersion: 1 }),
        ],
      );
    }
  }

  public async down(): Promise<void> {
    // Intentionally a no-op: this migration only backfills rows that the
    // original seed (CreateDocumentLayouts1760001008000) failed to persist
    // in production. Reverting would risk deleting templates already in use.
  }
}
