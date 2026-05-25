import { MigrationInterface, QueryRunner } from 'typeorm';

const sharedReset = `
/* Lyra Agency document template v2 */
.doc-page {
  position: relative;
  overflow: hidden;
}

.doc-header {
  position: relative;
  z-index: 2;
}

.doc-content {
  position: relative;
  z-index: 2;
}

.doc-footer {
  position: relative;
  z-index: 2;
}

.doc-grid div,
.doc-section,
.doc-totals,
.doc-hero {
  transition: none;
}

.doc-logo img {
  display: block;
  max-height: 54px;
  max-width: 190px;
  width: auto;
  height: auto;
  object-fit: contain;
}
`;

const templateCss: Record<string, string> = {
  essence: `
${sharedReset}

/* Essence — editorial, clean and minimal */
.doc-page.essence {
  background: #ffffff;
}

.doc-page.essence .doc-header {
  border-bottom: 1px solid #eef2f7;
}

.doc-page.essence .doc-hero {
  padding: 34px 0 22px;
  border-radius: 0;
  border-bottom: 1px solid #eef2f7;
  background: transparent;
}

.doc-page.essence .doc-hero h1 {
  max-width: 620px;
  font-size: 34px;
  letter-spacing: -0.055em;
}

.doc-page.essence .doc-grid {
  margin-top: 22px;
}

.doc-page.essence .doc-grid div,
.doc-page.essence .doc-section,
.doc-page.essence .doc-totals {
  border: 0;
  border-bottom: 1px solid #eef2f7;
  border-radius: 0;
  padding-left: 0;
  padding-right: 0;
}

.doc-page.essence .doc-section h2 {
  color: var(--doc-primary);
}
`,

  frame: `
${sharedReset}

/* Frame — structured commercial cards */
.doc-page.frame {
  background:
    linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}

.doc-page.frame .doc-header {
  border: 1px solid var(--doc-border);
  border-radius: 20px;
  padding: 16px;
  background: #ffffff;
}

.doc-page.frame .doc-hero {
  margin-top: 22px;
  border: 1px solid var(--doc-border);
  border-radius: 28px;
  background:
    linear-gradient(135deg, rgba(37, 99, 235, 0.09), #ffffff 58%);
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.07);
}

.doc-page.frame .doc-grid div,
.doc-page.frame .doc-section,
.doc-page.frame .doc-totals {
  border: 1px solid #dbe5f0;
  background: #ffffff;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.045);
}

.doc-page.frame .doc-section h2 {
  padding-bottom: 8px;
  border-bottom: 1px solid #e2e8f0;
}
`,

  authority: `
${sharedReset}

/* Authority — strong institutional proposal */
.doc-page.authority {
  background: #ffffff;
}

.doc-page.authority::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 118mm;
  background:
    radial-gradient(circle at 86% 14%, rgba(37, 99, 235, 0.35), transparent 34mm),
    linear-gradient(135deg, #0f172a 0%, #111827 58%, #1e3a8a 100%);
  z-index: 0;
}

.doc-page.authority .doc-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.18);
}

.doc-page.authority .doc-company span,
.doc-page.authority .doc-footer span {
  color: rgba(255, 255, 255, 0.7);
}

.doc-page.authority .doc-hero {
  margin-top: 28px;
  padding: 34px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
  color: #ffffff;
  backdrop-filter: blur(10px);
}

.doc-page.authority .doc-hero span,
.doc-page.authority .doc-hero p {
  color: rgba(255, 255, 255, 0.82);
}

.doc-page.authority .doc-grid {
  margin-top: 28px;
}

.doc-page.authority .doc-grid div {
  border: 0;
  background: #ffffff;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.12);
}

.doc-page.authority .doc-section,
.doc-page.authority .doc-totals {
  border-color: #dbeafe;
  background: #ffffff;
}
`,

  flow: `
${sharedReset}

/* Flow — process and steps */
.doc-page.flow {
  background:
    linear-gradient(90deg, rgba(37, 99, 235, 0.055) 0 14mm, #ffffff 14mm 100%);
}

.doc-page.flow::before {
  content: "";
  position: absolute;
  top: 46mm;
  bottom: 22mm;
  left: 12mm;
  width: 2px;
  background: linear-gradient(180deg, var(--doc-primary), rgba(37, 99, 235, 0.08));
}

.doc-page.flow .doc-header {
  border-bottom: 0;
}

.doc-page.flow .doc-hero {
  margin-left: 8mm;
  border-left: 5px solid var(--doc-primary);
  border-radius: 18px;
  background: #f8fafc;
}

.doc-page.flow .doc-grid,
.doc-page.flow .doc-section,
.doc-page.flow .doc-totals {
  margin-left: 8mm;
}

.doc-page.flow .doc-grid div,
.doc-page.flow .doc-section,
.doc-page.flow .doc-totals {
  border: 0;
  border-left: 4px solid rgba(37, 99, 235, 0.22);
  background: #ffffff;
  box-shadow: 0 14px 36px rgba(15, 23, 42, 0.055);
}

.doc-page.flow .doc-section h2::before {
  content: "•";
  margin-right: 8px;
  color: var(--doc-primary);
}
`,

  orbit: `
${sharedReset}

/* Orbit — Lyra visual signature */
.doc-page.orbit {
  background:
    radial-gradient(circle at 85% 8%, rgba(124, 58, 237, 0.18), transparent 42mm),
    radial-gradient(circle at 8% 35%, rgba(37, 99, 235, 0.12), transparent 36mm),
    #ffffff;
}

.doc-page.orbit::before,
.doc-page.orbit::after {
  content: "";
  position: absolute;
  border: 1px solid rgba(124, 58, 237, 0.18);
  border-radius: 999px;
  pointer-events: none;
}

.doc-page.orbit::before {
  width: 120mm;
  height: 120mm;
  top: -50mm;
  right: -44mm;
}

.doc-page.orbit::after {
  width: 72mm;
  height: 72mm;
  top: 14mm;
  right: -22mm;
  border-color: rgba(37, 99, 235, 0.16);
}

.doc-page.orbit .doc-header {
  border-bottom: 0;
}

.doc-page.orbit .doc-hero {
  border: 1px solid rgba(124, 58, 237, 0.18);
  background:
    linear-gradient(135deg, rgba(124, 58, 237, 0.12), rgba(37, 99, 235, 0.05));
}

.doc-page.orbit .doc-grid div,
.doc-page.orbit .doc-section,
.doc-page.orbit .doc-totals {
  border-color: rgba(124, 58, 237, 0.18);
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 18px 44px rgba(76, 29, 149, 0.08);
}

.doc-page.orbit .doc-section h2 {
  color: #6d28d9;
}
`,

  pulse: `
${sharedReset}

/* Pulse — growth, tech and performance */
.doc-page.pulse {
  background:
    linear-gradient(180deg, rgba(14, 165, 233, 0.09), transparent 45mm),
    #ffffff;
}

.doc-page.pulse .doc-header {
  border-bottom: 0;
}

.doc-page.pulse .doc-hero {
  position: relative;
  border-radius: 18px;
  border-top: 7px solid var(--doc-primary);
  background:
    repeating-linear-gradient(
      -45deg,
      rgba(37, 99, 235, 0.06),
      rgba(37, 99, 235, 0.06) 8px,
      rgba(14, 165, 233, 0.025) 8px,
      rgba(14, 165, 233, 0.025) 16px
    );
}

.doc-page.pulse .doc-hero::after {
  content: "";
  position: absolute;
  right: 24px;
  bottom: 22px;
  width: 92px;
  height: 28px;
  background:
    linear-gradient(90deg, var(--doc-primary), #0ea5e9);
  border-radius: 999px;
  opacity: 0.16;
}

.doc-page.pulse .doc-grid div {
  border: 0;
  border-top: 4px solid var(--doc-primary);
  background: #ffffff;
  box-shadow: 0 16px 38px rgba(14, 165, 233, 0.09);
}

.doc-page.pulse .doc-section,
.doc-page.pulse .doc-totals {
  border-color: rgba(14, 165, 233, 0.26);
}

.doc-page.pulse .doc-section h2 {
  display: inline-block;
  padding: 5px 10px;
  border-radius: 999px;
  color: #0369a1;
  background: rgba(14, 165, 233, 0.11);
}
`,

  signature: `
${sharedReset}

/* Signature — premium consultative */
.doc-page.signature {
  background:
    linear-gradient(90deg, #0f172a 0 12mm, #ffffff 12mm 100%);
}

.doc-page.signature::before {
  content: "";
  position: absolute;
  top: 20mm;
  left: 8mm;
  bottom: 20mm;
  width: 1px;
  background: linear-gradient(180deg, #f59e0b, transparent);
}

.doc-page.signature .doc-header {
  border-bottom: 1px solid rgba(245, 158, 11, 0.28);
  padding-left: 8mm;
}

.doc-page.signature .doc-hero {
  margin-left: 8mm;
  border: 1px solid rgba(245, 158, 11, 0.28);
  border-radius: 26px;
  background:
    radial-gradient(circle at top right, rgba(245, 158, 11, 0.18), transparent 45mm),
    #ffffff;
  box-shadow: 0 22px 60px rgba(15, 23, 42, 0.1);
}

.doc-page.signature .doc-hero span {
  color: #b45309;
}

.doc-page.signature .doc-grid,
.doc-page.signature .doc-section,
.doc-page.signature .doc-totals {
  margin-left: 8mm;
}

.doc-page.signature .doc-grid div,
.doc-page.signature .doc-section,
.doc-page.signature .doc-totals {
  border-color: rgba(245, 158, 11, 0.24);
  background: #fffaf0;
}

.doc-page.signature .doc-section h2 {
  color: #92400e;
}
`,
};

export class EnhanceDocumentLayoutTemplates1760001009000
  implements MigrationInterface
{
  name = 'EnhanceDocumentLayoutTemplates1760001009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [type, css] of Object.entries(templateCss)) {
      await queryRunner.query(
        `
          UPDATE "document_layout_templates"
          SET
            "css_template" = "css_template" || $1::text,
            "metadata" = COALESCE("metadata", '{}'::jsonb) || $2::jsonb,
            "updated_at" = now()
          WHERE "document_type" = 'quote'
            AND "type" = $3::varchar
            AND "is_system" = true;
        `,
        [
          css,
          JSON.stringify({
            visualVersion: 2,
            visualUpdatedAt: '2026-05-25',
          }),
          type,
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "document_layout_templates"
      SET
        "metadata" = COALESCE("metadata", '{}'::jsonb) - 'visualVersion' - 'visualUpdatedAt',
        "updated_at" = now()
      WHERE "document_type" = 'quote'
        AND "is_system" = true;
    `);
  }
}
