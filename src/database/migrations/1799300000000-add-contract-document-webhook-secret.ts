import type { MigrationInterface, QueryRunner } from 'typeorm';

// Autentique splits webhooks by category (document / signature / member) and
// each registered endpoint has its own secret. The existing
// `webhook_secret_encrypted` keeps the signature-category secret; this column
// holds the document-category one (`document.finished`).
export class AddContractDocumentWebhookSecret1799300000000 implements MigrationInterface {
  name = 'AddContractDocumentWebhookSecret1799300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agency_contract_signature_provider_settings"
        ADD COLUMN IF NOT EXISTS "document_webhook_secret_encrypted" text
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agency_contract_signature_provider_settings"
        DROP COLUMN IF EXISTS "document_webhook_secret_encrypted"
    `);
  }
}
