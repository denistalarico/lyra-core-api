import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyFinanceFiscalProfile1760002019000
  implements MigrationInterface
{
  name = 'CreateAgencyFinanceFiscalProfile1760002019000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "finance_fiscal_profiles_default_document_model_enum" AS ENUM (
        'nfe',
        'nfce',
        'nfse',
        'invoice',
        'receipt'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_fiscal_profiles_brazil_tax_regime_enum" AS ENUM (
        'none',
        'simples_nacional',
        'simples_nacional_excess',
        'normal_lucro_presumido',
        'normal_lucro_real'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_fiscal_profiles_service_city_origin_enum" AS ENUM (
        'provider',
        'customer'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_fiscal_profiles_ibs_cbs_operation_type_enum" AS ENUM (
        '0',
        '1',
        '2',
        '3',
        '4',
        '5'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_fiscal_profiles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "fiscal_country" varchar(2) NOT NULL DEFAULT 'BR',
        "default_document_model" "finance_fiscal_profiles_default_document_model_enum" NOT NULL DEFAULT 'nfse',
        "municipal_registration" varchar(80),
        "is_simples_nacional" boolean NOT NULL DEFAULT false,
        "brazil_tax_regime" "finance_fiscal_profiles_brazil_tax_regime_enum" NOT NULL DEFAULT 'none',
        "has_special_tax_regime" boolean NOT NULL DEFAULT false,
        "special_tax_regime_code" varchar(80),
        "nfse_series" varchar(20),
        "next_rps_number" integer,
        "next_batch_number" integer,
        "cnae" varchar(20),
        "city_service_code" varchar(80),
        "city_taxation_code" varchar(80),
        "iss_rate" numeric(8,4) NOT NULL DEFAULT 0,
        "city_service_description" text,
        "service_city_origin" "finance_fiscal_profiles_service_city_origin_enum" NOT NULL DEFAULT 'provider',
        "default_nbs_code" varchar(80),
        "national_service_code" varchar(80),
        "has_iss_immunity" boolean NOT NULL DEFAULT false,
        "certificate_object_key" varchar(255),
        "certificate_file_name" varchar(255),
        "certificate_password_encrypted" text,
        "certificate_expires_at" timestamptz,
        "is_personal_operation" boolean NOT NULL DEFAULT false,
        "operation_indicator_code" varchar(80),
        "ibs_cbs_cct" varchar(80),
        "ibs_cbs_cst" varchar(80),
        "ibs_municipal_rate" numeric(8,4) NOT NULL DEFAULT 0,
        "ibs_state_rate" numeric(8,4) NOT NULL DEFAULT 0,
        "cbs_rate" numeric(8,4) NOT NULL DEFAULT 0,
        "ibs_cbs_operation_type" "finance_fiscal_profiles_ibs_cbs_operation_type_enum" NOT NULL DEFAULT '0',
        "deferral_state_percent" numeric(8,4) NOT NULL DEFAULT 0,
        "deferral_municipal_percent" numeric(8,4) NOT NULL DEFAULT 0,
        "deferral_cbs_percent" numeric(8,4) NOT NULL DEFAULT 0,
        "fiscal_provider" varchar(80),
        "provider_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_fiscal_profiles" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_finance_fiscal_profiles_scope"
      ON "finance_fiscal_profiles" ("tenant_id", "workspace_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_finance_fiscal_profiles_scope"`);
    await queryRunner.query(`DROP TABLE "finance_fiscal_profiles"`);
    await queryRunner.query(`DROP TYPE "finance_fiscal_profiles_ibs_cbs_operation_type_enum"`);
    await queryRunner.query(`DROP TYPE "finance_fiscal_profiles_service_city_origin_enum"`);
    await queryRunner.query(`DROP TYPE "finance_fiscal_profiles_brazil_tax_regime_enum"`);
    await queryRunner.query(`DROP TYPE "finance_fiscal_profiles_default_document_model_enum"`);
  }
}
