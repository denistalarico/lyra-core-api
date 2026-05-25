import { AgencyDataSource } from '../database/agency-typeorm.datasource';
import { systemDocumentLayoutTemplates } from '../modules/document-layouts/document-layout-system-templates';

async function main() {
  await AgencyDataSource.initialize();

  try {
    let updatedCount = 0;

    for (const template of systemDocumentLayoutTemplates) {
      const result = await AgencyDataSource.query(
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

      const affectedRows =
        Array.isArray(result) && typeof result[1] === 'number' ? result[1] : 0;
      updatedCount += affectedRows;
      console.log(
        `${template.name}: ${affectedRows === 1 ? 'updated' : 'not found'}`,
      );
    }

    console.log(`Document layout system templates updated: ${updatedCount}`);
  } finally {
    await AgencyDataSource.destroy();
  }
}

main().catch(async (error) => {
  console.error('Failed to update document layout templates.');
  console.error(error);

  if (AgencyDataSource.isInitialized) {
    await AgencyDataSource.destroy();
  }

  process.exit(1);
});
