import { MigrationInterface, QueryRunner } from 'typeorm';
import { systemDocumentLayoutTemplates } from '../../modules/document-layouts/document-layout-system-templates';

export class RefineDocumentLayoutTemplatesV31760001010000 implements MigrationInterface {
  name = 'RefineDocumentLayoutTemplatesV31760001010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const template of systemDocumentLayoutTemplates) {
      await queryRunner.query(
        `
          UPDATE "document_layout_templates"
          SET
            "name" = $1::varchar,
            "html_template" = $2::text,
            "css_template" = $3::text,
            "preview_data" = $4::jsonb,
            "metadata" = COALESCE("metadata", '{}'::jsonb) || $5::jsonb,
            "updated_at" = now()
          WHERE "document_type" = 'quote'
            AND "is_system" = true
            AND "type" = $6::varchar;
        `,
        [
          template.name,
          template.htmlTemplate,
          template.cssTemplate,
          JSON.stringify(template.previewData),
          JSON.stringify(template.metadata),
          template.type,
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "document_layout_templates"
      SET
        "metadata" = COALESCE("metadata", '{}'::jsonb)
          - 'visualVersion'
          - 'visualUpdatedAt'
          - 'summaryLayout'
          - 'closingLayout',
        "updated_at" = now()
      WHERE "document_type" = 'quote'
        AND "is_system" = true;
    `);
  }
}
