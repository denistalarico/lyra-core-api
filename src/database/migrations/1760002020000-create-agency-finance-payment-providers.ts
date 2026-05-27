import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyFinancePaymentProviders1760002020000
  implements MigrationInterface
{
  name = 'CreateAgencyFinancePaymentProviders1760002020000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "finance_payment_providers_provider_type_enum" AS ENUM (
        'stripe',
        'mercado_pago',
        'asaas',
        'cobre_facil',
        'manual',
        'pix',
        'other'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_payment_providers_status_enum" AS ENUM (
        'draft',
        'connected',
        'disconnected',
        'error'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_payment_providers_environment_enum" AS ENUM (
        'sandbox',
        'production'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_payment_providers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "provider_type" "finance_payment_providers_provider_type_enum" NOT NULL,
        "status" "finance_payment_providers_status_enum" NOT NULL DEFAULT 'draft',
        "environment" "finance_payment_providers_environment_enum" NOT NULL DEFAULT 'sandbox',
        "is_default_for_customer_payments" boolean NOT NULL DEFAULT false,
        "is_default_for_vendor_payments" boolean NOT NULL DEFAULT false,
        "supports_pix" boolean NOT NULL DEFAULT false,
        "supports_card" boolean NOT NULL DEFAULT false,
        "supports_boleto" boolean NOT NULL DEFAULT false,
        "supports_bank_slip" boolean NOT NULL DEFAULT false,
        "supports_bank_transfer" boolean NOT NULL DEFAULT false,
        "public_key" text,
        "secret_key_encrypted" text,
        "access_token_encrypted" text,
        "refresh_token_encrypted" text,
        "webhook_secret_encrypted" text,
        "external_account_id" varchar(160),
        "last_health_check_at" timestamptz,
        "last_health_check_status" varchar(80),
        "last_error_message" text,
        "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_payment_providers" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_finance_payment_providers_scope"
      ON "finance_payment_providers" ("tenant_id", "workspace_id", "provider_type")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_finance_payment_providers_status"
      ON "finance_payment_providers" ("tenant_id", "workspace_id", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_finance_payment_providers_status"`);
    await queryRunner.query(`DROP INDEX "IDX_finance_payment_providers_scope"`);
    await queryRunner.query(`DROP TABLE "finance_payment_providers"`);
    await queryRunner.query(`DROP TYPE "finance_payment_providers_environment_enum"`);
    await queryRunner.query(`DROP TYPE "finance_payment_providers_status_enum"`);
    await queryRunner.query(`DROP TYPE "finance_payment_providers_provider_type_enum"`);
  }
}
