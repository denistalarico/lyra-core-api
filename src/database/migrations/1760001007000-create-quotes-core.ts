import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateQuotesCore1760001007000 implements MigrationInterface {
  name = 'CreateQuotesCore1760001007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "quote_templates" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid,
        "workspace_id" uuid,
        "name" varchar(120) NOT NULL,
        "description" text,
        "type" varchar(40) NOT NULL DEFAULT 'simple_quote',
        "status" varchar(30) NOT NULL DEFAULT 'active',
        "is_system" boolean NOT NULL DEFAULT false,
        "is_default" boolean NOT NULL DEFAULT false,
        "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_quote_templates_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "quote_template_sections" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "template_id" uuid NOT NULL,
        "key" varchar(80) NOT NULL,
        "title" varchar(120) NOT NULL,
        "content" text,
        "position" int NOT NULL DEFAULT 0,
        "is_required" boolean NOT NULL DEFAULT false,
        "is_visible" boolean NOT NULL DEFAULT true,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_quote_template_sections_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_quote_template_sections_template"
          FOREIGN KEY ("template_id")
          REFERENCES "quote_templates" ("id")
          ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "quotes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "template_id" uuid,
        "quote_number" varchar(40) NOT NULL,
        "title" varchar(180) NOT NULL,
        "status" varchar(30) NOT NULL DEFAULT 'draft',
        "currency" varchar(10) NOT NULL DEFAULT 'BRL',
        "contact_id" uuid,
        "company_contact_id" uuid,
        "opportunity_id" uuid,
        "valid_until" date,
        "subtotal_cents" int NOT NULL DEFAULT 0,
        "discount_cents" int NOT NULL DEFAULT 0,
        "tax_cents" int NOT NULL DEFAULT 0,
        "total_cents" int NOT NULL DEFAULT 0,
        "recurring_total_cents" int NOT NULL DEFAULT 0,
        "internal_notes" text,
        "terms_and_conditions" text,
        "accepted_at" timestamptz,
        "accepted_by_name" varchar(160),
        "accepted_by_email" varchar(180),
        "rejected_at" timestamptz,
        "rejection_reason" varchar(240),
        "source_product" varchar(60),
        "source_context" varchar(80),
        "created_by_user_id" uuid,
        "updated_by_user_id" uuid,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_quotes_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_quotes_number_workspace" UNIQUE ("tenant_id", "workspace_id", "quote_number"),
        CONSTRAINT "fk_quotes_template"
          FOREIGN KEY ("template_id")
          REFERENCES "quote_templates" ("id")
          ON DELETE SET NULL,
        CONSTRAINT "fk_quotes_opportunity"
          FOREIGN KEY ("opportunity_id")
          REFERENCES "agency_sales_opportunities" ("id")
          ON DELETE SET NULL
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "quote_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "quote_id" uuid NOT NULL,
        "sales_item_id" uuid,
        "name" varchar(140) NOT NULL,
        "description" text,
        "type" varchar(30) NOT NULL DEFAULT 'service',
        "currency" varchar(10) NOT NULL DEFAULT 'BRL',
        "quantity" int NOT NULL DEFAULT 1,
        "unit_price_cents" int NOT NULL DEFAULT 0,
        "setup_price_cents" int NOT NULL DEFAULT 0,
        "recurring_price_cents" int NOT NULL DEFAULT 0,
        "discount_type" varchar(20) NOT NULL DEFAULT 'none',
        "discount_value" int NOT NULL DEFAULT 0,
        "tax_rate_bps" int NOT NULL DEFAULT 0,
        "subtotal_cents" int NOT NULL DEFAULT 0,
        "discount_cents" int NOT NULL DEFAULT 0,
        "tax_cents" int NOT NULL DEFAULT 0,
        "total_cents" int NOT NULL DEFAULT 0,
        "recurring_total_cents" int NOT NULL DEFAULT 0,
        "recurrence_interval" varchar(20),
        "position" int NOT NULL DEFAULT 0,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_quote_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_quote_items_quote"
          FOREIGN KEY ("quote_id")
          REFERENCES "quotes" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_quote_items_sales_item"
          FOREIGN KEY ("sales_item_id")
          REFERENCES "agency_sales_items" ("id")
          ON DELETE SET NULL
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "quote_status_history" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "quote_id" uuid NOT NULL,
        "from_status" varchar(30),
        "to_status" varchar(30) NOT NULL,
        "reason" varchar(240),
        "changed_by_user_id" uuid,
        "changed_at" timestamptz NOT NULL DEFAULT now(),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        CONSTRAINT "pk_quote_status_history_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_quote_status_history_quote"
          FOREIGN KEY ("quote_id")
          REFERENCES "quotes" ("id")
          ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_quote_templates_tenant_workspace" ON "quote_templates" (tenant_id, workspace_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_quote_templates_status" ON "quote_templates" (tenant_id, workspace_id, status);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_quote_templates_system_type" ON "quote_templates" (is_system, type);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_quote_template_sections_template" ON "quote_template_sections" (template_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_quotes_tenant_workspace" ON "quotes" (tenant_id, workspace_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_quotes_status" ON "quotes" (tenant_id, workspace_id, status);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_quotes_contact" ON "quotes" (contact_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_quotes_company_contact" ON "quotes" (company_contact_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_quotes_opportunity" ON "quotes" (opportunity_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_quote_items_quote" ON "quote_items" (quote_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_quote_items_tenant_workspace" ON "quote_items" (tenant_id, workspace_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_quote_status_history_quote" ON "quote_status_history" (quote_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_quote_status_history_tenant_workspace" ON "quote_status_history" (tenant_id, workspace_id);`);

    await queryRunner.query(`
      INSERT INTO "quote_templates" ("name", "description", "type", "is_system", "is_default", "settings", "metadata")
      VALUES
        ('Proposta Simples', 'Modelo objetivo para orçamentos rápidos e propostas diretas.', 'simple_quote', true, true, '{"layout":"simple","pdfReady":false}'::jsonb, '{"source":"lyra_system"}'::jsonb),
        ('Proposta Comercial Completa', 'Modelo com apresentação, escopo, itens, condições e termos comerciais.', 'commercial_proposal', true, false, '{"layout":"commercial","pdfReady":false}'::jsonb, '{"source":"lyra_system"}'::jsonb),
        ('Serviço Mensal / Recorrente', 'Modelo para planos mensais, contratos recorrentes e prestação contínua.', 'monthly_service', true, false, '{"layout":"recurring","pdfReady":false}'::jsonb, '{"source":"lyra_system"}'::jsonb),
        ('Projeto Único', 'Modelo para projetos fechados, implantação, setup ou entrega pontual.', 'one_time_project', true, false, '{"layout":"project","pdfReady":false}'::jsonb, '{"source":"lyra_system"}'::jsonb),
        ('Proposta Premium Consultiva', 'Modelo mais completo para propostas estratégicas, consultivas ou de maior ticket.', 'premium_consultative', true, false, '{"layout":"premium","pdfReady":false}'::jsonb, '{"source":"lyra_system"}'::jsonb)
      ON CONFLICT DO NOTHING;
    `);

    await queryRunner.query(`
      INSERT INTO "quote_template_sections" ("template_id", "key", "title", "content", "position", "is_required", "is_visible")
      SELECT id, 'intro', 'Apresentação', 'Resumo da proposta e contexto comercial.', 10, false, true
      FROM "quote_templates"
      WHERE "is_system" = true
      ON CONFLICT DO NOTHING;
    `);

    await queryRunner.query(`
      INSERT INTO "quote_template_sections" ("template_id", "key", "title", "content", "position", "is_required", "is_visible")
      SELECT id, 'scope', 'Escopo', 'Descrição do escopo, entregáveis e responsabilidades.', 20, false, true
      FROM "quote_templates"
      WHERE "is_system" = true
      ON CONFLICT DO NOTHING;
    `);

    await queryRunner.query(`
      INSERT INTO "quote_template_sections" ("template_id", "key", "title", "content", "position", "is_required", "is_visible")
      SELECT id, 'commercial_terms', 'Condições Comerciais', 'Valores, validade, condições de pagamento e observações.', 30, true, true
      FROM "quote_templates"
      WHERE "is_system" = true
      ON CONFLICT DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_quote_status_history_tenant_workspace";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_quote_status_history_quote";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_quote_items_tenant_workspace";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_quote_items_quote";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_quotes_opportunity";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_quotes_company_contact";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_quotes_contact";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_quotes_status";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_quotes_tenant_workspace";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_quote_template_sections_template";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_quote_templates_system_type";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_quote_templates_status";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_quote_templates_tenant_workspace";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "quote_status_history";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "quote_items";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "quotes";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "quote_template_sections";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "quote_templates";`);
  }
}
