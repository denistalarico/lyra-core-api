import { MigrationInterface, QueryRunner } from 'typeorm';
import { systemDocumentLayoutTemplates } from '../../modules/document-layouts/document-layout-system-templates';

export class UpdateDocumentLayoutTemplatesMultiDoc1760002038000 implements MigrationInterface {
  name = 'UpdateDocumentLayoutTemplatesMultiDoc1760002038000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const template of systemDocumentLayoutTemplates) {
      await queryRunner.query(
        `
          UPDATE "document_layout_templates"
          SET
            "html_template" = $1::text,
            "css_template" = $2::text,
            "metadata" = COALESCE("metadata", '{}'::jsonb) || $3::jsonb,
            "updated_at" = now()
          WHERE "document_type" = 'quote'
            AND "is_system" = true
            AND "type" = $4::varchar;
        `,
        [
          template.htmlTemplate,
          template.cssTemplate,
          JSON.stringify({ ...template.metadata, multiDocVersion: 1 }),
          template.type,
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "document_layout_templates"
      SET
        "metadata" = COALESCE("metadata", '{}'::jsonb) - 'multiDocVersion',
        "updated_at" = now()
      WHERE "document_type" = 'quote'
        AND "is_system" = true;
    `);
  }
}
