import { MigrationInterface, QueryRunner } from 'typeorm';

const baseHtmlTemplate = `
<div class="doc-page {{layoutType}}">
  <header class="doc-header">
    <div class="doc-brand">{{companyBrandBlock}}</div>
    <div class="doc-company">
      <span>{{companyAddress}}</span>
      <span>{{companyCity}} {{companyRegion}} {{companyPostalCode}}</span>
      <span>{{companyEmail}} {{companyPhone}}</span>
    </div>
  </header>

  <main class="doc-content">
    <section class="doc-hero">
      <span>{{documentTypeLabel}}</span>
      <h1>{{documentTitle}}</h1>
      <p>{{documentSubtitle}}</p>
    </section>

    <section class="doc-grid">
      <div>
        <small>Cliente</small>
        <strong>{{customerName}}</strong>
      </div>
      <div>
        <small>Número</small>
        <strong>{{documentNumber}}</strong>
      </div>
      <div>
        <small>Validade</small>
        <strong>{{validUntil}}</strong>
      </div>
    </section>

    <section class="doc-section">
      <h2>Itens</h2>
      {{itemsTable}}
    </section>

    <section class="doc-totals">
      {{totalsTable}}
    </section>

    <section class="doc-section">
      <h2>Termos e condições</h2>
      <p>{{termsAndConditions}}</p>
    </section>
  </main>

  <footer class="doc-footer">
    <span>{{footerText}}</span>
    <span>{{companyDocumentLabel}} {{companyDocumentValue}}</span>
  </footer>
</div>
`;

const baseCssTemplate = `
:root {
  --doc-primary: {{primaryColor}};
  --doc-secondary: {{secondaryColor}};
  --doc-text: {{textColor}};
  --doc-bg: {{backgroundColor}};
  --doc-muted: #64748b;
  --doc-border: #e2e8f0;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #f1f5f9;
  color: var(--doc-text);
  font-family: {{fontFamily}}, Arial, sans-serif;
}

.doc-page {
  width: 210mm;
  min-height: 297mm;
  margin: 0 auto;
  padding: 20mm;
  background: var(--doc-bg);
  color: var(--doc-text);
}

.doc-header,
.doc-footer {
  display: flex;
  justify-content: space-between;
  gap: 24px;
}

.doc-header {
  align-items: flex-start;
  border-bottom: 1px solid var(--doc-border);
  padding-bottom: 18px;
}

.doc-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.doc-logo {
  min-width: 44px;
  min-height: 44px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: rgba(37, 99, 235, 0.1);
  color: var(--doc-primary);
  font-weight: 900;
}

.doc-brand strong {
  display: block;
  font-family: {{headingFontFamily}}, Arial, sans-serif;
  font-size: 20px;
}

.doc-brand span,
.doc-company span,
.doc-footer span {
  display: block;
  color: var(--doc-muted);
  font-size: 10px;
  line-height: 1.5;
}

.doc-company {
  text-align: right;
}

.doc-content {
  padding: 28px 0;
}

.doc-hero {
  border-radius: 24px;
  padding: 26px;
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.1), transparent);
}

.doc-hero span {
  color: var(--doc-primary);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.doc-hero h1,
.doc-section h2 {
  font-family: {{headingFontFamily}}, Arial, sans-serif;
}

.doc-hero h1 {
  margin: 8px 0;
  font-size: 30px;
  line-height: 1.08;
}

.doc-hero p {
  margin: 0;
  color: var(--doc-muted);
  font-size: 13px;
  line-height: 1.6;
}

.doc-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 18px;
}

.doc-grid div,
.doc-section,
.doc-totals {
  border: 1px solid var(--doc-border);
  border-radius: 16px;
  padding: 14px;
}

.doc-grid small {
  display: block;
  color: var(--doc-muted);
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
}

.doc-grid strong {
  display: block;
  margin-top: 4px;
  font-size: 12px;
}

.doc-section,
.doc-totals {
  margin-top: 16px;
}

.doc-section h2 {
  margin: 0 0 12px;
  font-size: 16px;
}

.doc-section p {
  margin: 0;
  color: var(--doc-muted);
  font-size: 12px;
  line-height: 1.6;
}

.doc-footer {
  border-top: 1px solid var(--doc-border);
  padding-top: 12px;
}

.doc-page.frame .doc-section,
.doc-page.frame .doc-grid div,
.doc-page.frame .doc-totals {
  background: #f8fafc;
}

.doc-page.authority .doc-hero {
  background: var(--doc-secondary);
  color: #ffffff;
}

.doc-page.authority .doc-hero span,
.doc-page.authority .doc-hero p {
  color: rgba(255, 255, 255, 0.82);
}

.doc-page.flow .doc-section {
  border-left: 4px solid var(--doc-primary);
}

.doc-page.orbit .doc-hero {
  background:
    radial-gradient(circle at top right, rgba(124, 58, 237, 0.16), transparent 220px),
    linear-gradient(135deg, rgba(37, 99, 235, 0.09), transparent);
}

.doc-page.pulse .doc-hero {
  border-top: 5px solid var(--doc-primary);
  background: linear-gradient(90deg, rgba(37, 99, 235, 0.12), rgba(14, 165, 233, 0.04));
}

.doc-page.signature .doc-hero {
  border: 1px solid rgba(245, 158, 11, 0.28);
  background:
    radial-gradient(circle at top right, rgba(245, 158, 11, 0.16), transparent 220px),
    #ffffff;
}

@media print {
  body {
    background: #ffffff;
  }

  .doc-page {
    margin: 0;
    box-shadow: none;
  }
}
`;

const previewData = {
  documentTypeLabel: 'Proposta comercial',
  documentTitle: 'Proposta de Marketing sob Medida',
  documentSubtitle:
    'Documento comercial preparado para apresentar escopo, investimento e condições.',
  customerName: 'Cliente Exemplo',
  documentNumber: 'Q-2026-0001',
  validUntil: '30/06/2026',
  termsAndConditions:
    'Esta proposta é válida até a data informada e pode ser ajustada conforme escopo aprovado.',
};

const templates = [
  {
    name: 'Essence',
    type: 'essence',
    description: 'Minimalista, limpo e objetivo.',
  },
  {
    name: 'Frame',
    type: 'frame',
    description: 'Blocos comerciais organizados e fáceis de comparar.',
  },
  {
    name: 'Authority',
    type: 'authority',
    description: 'Forte, institucional e ideal para tickets altos.',
  },
  {
    name: 'Flow',
    type: 'flow',
    description: 'Fluido e ideal para escopos por etapas.',
  },
  {
    name: 'Orbit',
    type: 'orbit',
    description: 'Visual exclusivo Lyra, moderno e premium.',
  },
  {
    name: 'Pulse',
    type: 'pulse',
    description: 'Dinâmico para growth, performance e tecnologia.',
  },
  {
    name: 'Signature',
    type: 'signature',
    description: 'Sofisticado para propostas consultivas e premium.',
  },
];

export class CreateDocumentLayouts1760001008000
  implements MigrationInterface
{
  name = 'CreateDocumentLayouts1760001008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "document_layouts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "scope" varchar(40) NOT NULL DEFAULT 'agency',
        "layout_type" varchar(40) NOT NULL DEFAULT 'essence',
        "background_type" varchar(40) NOT NULL DEFAULT 'white',
        "paper_format" varchar(20) NOT NULL DEFAULT 'a4',
        "font_family" varchar(80) NOT NULL DEFAULT 'Inter',
        "heading_font_family" varchar(80) NOT NULL DEFAULT 'Sora',
        "logo_url" text,
        "logo_position" varchar(20) NOT NULL DEFAULT 'left',
        "logo_size" varchar(20) NOT NULL DEFAULT 'medium',
        "primary_color" varchar(20) NOT NULL DEFAULT '#2563EB',
        "secondary_color" varchar(20) NOT NULL DEFAULT '#0F172A',
        "text_color" varchar(20) NOT NULL DEFAULT '#0F172A',
        "background_color" varchar(20) NOT NULL DEFAULT '#FFFFFF',
        "company_name" varchar(160),
        "company_document_label" varchar(40),
        "company_document_value" varchar(80),
        "company_address" text,
        "company_city" varchar(100),
        "company_region" varchar(100),
        "company_postal_code" varchar(40),
        "company_country" varchar(100),
        "company_phone" varchar(80),
        "company_email" varchar(160),
        "company_website" varchar(160),
        "slogan" text,
        "footer_text" text,
        "show_qr_code" boolean NOT NULL DEFAULT false,
        "is_default" boolean NOT NULL DEFAULT false,
        "status" varchar(30) NOT NULL DEFAULT 'active',
        "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_document_layouts_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "document_layout_templates" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid,
        "workspace_id" uuid,
        "layout_id" uuid,
        "name" varchar(120) NOT NULL,
        "type" varchar(40) NOT NULL,
        "document_type" varchar(40) NOT NULL DEFAULT 'quote',
        "html_template" text NOT NULL,
        "css_template" text NOT NULL,
        "preview_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "is_system" boolean NOT NULL DEFAULT false,
        "is_default" boolean NOT NULL DEFAULT false,
        "status" varchar(30) NOT NULL DEFAULT 'active',
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_document_layout_templates_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_document_layouts_tenant_workspace"
      ON "document_layouts" (tenant_id, workspace_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_document_layouts_default"
      ON "document_layouts" (tenant_id, workspace_id, scope, is_default);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_document_layout_templates_system"
      ON "document_layout_templates" (document_type, type, is_system);
    `);

    for (const template of templates) {
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
          baseHtmlTemplate,
          baseCssTemplate,
          JSON.stringify(previewData),
          template.type === 'essence',
          JSON.stringify({ description: template.description }),
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_document_layout_templates_system";`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_document_layouts_default";`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_document_layouts_tenant_workspace";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "document_layout_templates";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "document_layouts";`);
  }
}
