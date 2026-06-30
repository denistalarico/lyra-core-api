import type { DocumentLayoutType } from './entities/document-layout.entities';

export type SystemDocumentLayoutTemplate = {
  name: string;
  type: DocumentLayoutType;
  description: string;
  htmlTemplate: string;
  cssTemplate: string;
  previewData: Record<string, unknown>;
  isDefault: boolean;
  metadata: Record<string, unknown>;
};

export const documentLayoutHtmlTemplate = `
<div class="doc-page doc-template-{{layoutType}} {{layoutType}}">
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
      <div class="doc-hero-copy">
        <span class="doc-kicker">{{documentTypeLabel}}</span>
        <h1>{{documentTitle}}</h1>
        <p>{{documentSubtitle}}</p>
      </div>
      {{customerHeaderBlock}}
    </section>

    <section class="doc-grid">
      <div>
        <small>{{documentNumberLabel}}</small>
        <strong>{{documentNumber}}</strong>
      </div>
      {{dateGridCells}}
    </section>

    <section class="doc-section doc-items">
      <h2>Itens</h2>
      {{itemsTable}}
    </section>

    <section class="doc-closing{{closingModifier}}">
      {{termsBlock}}

      <div class="doc-totals-panel doc-totals">
        <h3>Resumo financeiro</h3>
        {{totalsTable}}
      </div>
    </section>
  </main>

  <footer class="doc-footer">
    <span>{{footerText}}</span>
    <span>{{companyDocumentLabel}} {{companyDocumentValue}}</span>
  </footer>
</div>
`;

const sharedCss = `
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
  position: relative;
  overflow: hidden;
  width: 210mm;
  min-height: 297mm;
  margin: 0 auto;
  padding: 20mm;
  background: var(--doc-bg);
  color: var(--doc-text);
}

.doc-header,
.doc-content,
.doc-footer {
  position: relative;
  z-index: 2;
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
  display: flex;
  align-items: center;
  min-width: auto;
  min-height: auto;
  border-radius: 0;
  background: transparent !important;
  color: var(--doc-primary);
  font-weight: 900;
}

.doc-logo--center {
  justify-content: center;
}

.doc-logo--right {
  justify-content: flex-end;
}

.doc-logo:empty {
  display: none;
}

.doc-logo img {
  display: block;
  max-height: 54px;
  max-width: 190px;
  width: auto;
  height: auto;
  object-fit: contain;
  background: transparent !important;
  color: transparent;
  font-size: 0;
}

.doc-logo img:not([src]),
.doc-logo img[src=""] {
  display: none !important;
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

.doc-brand span:empty {
  display: none;
}

.doc-company {
  text-align: right;
}

.doc-content {
  padding: 26px 0;
}

.doc-hero {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
  border-radius: 24px;
  padding: 26px;
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.1), transparent);
}

.doc-hero-copy {
  min-width: 0;
}

.doc-kicker,
.doc-hero > span {
  color: var(--doc-primary);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.doc-hero h1,
.doc-section h2,
.doc-terms-panel h3,
.doc-totals-panel h3 {
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

.doc-customer-header {
  display: flex;
  gap: 10px;
  align-items: center;
  max-width: 245px;
  text-align: right;
}

.doc-customer-header-avatar {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  place-items: center;
  overflow: hidden;
  border-radius: 999px;
  background: var(--doc-primary);
  color: #ffffff;
  font-size: 14px;
  font-weight: 800;
}

.doc-customer-header-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.doc-customer-header small {
  display: block;
  color: var(--doc-muted);
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
}

.doc-customer-header strong {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.25;
}

.doc-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 18px;
}

.doc-grid div,
.doc-section {
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

.doc-section {
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

.doc-items table,
.doc-items-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.doc-items th,
.doc-items td,
.doc-items-table th,
.doc-items-table td {
  padding: 9px 10px;
  border-bottom: 1px solid var(--doc-border);
  vertical-align: top;
}

.doc-items th,
.doc-items-table th {
  color: var(--doc-muted);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.doc-items td,
.doc-items-table td {
  color: var(--doc-text);
}

.doc-items tr:last-child td,
.doc-items-table tr:last-child td {
  border-bottom: 0;
}

.doc-closing {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(220px, 0.85fr);
  gap: 18px;
  align-items: stretch;
  margin-top: 18px;
}

.doc-closing--no-terms {
  grid-template-columns: 1fr;
}

.doc-terms-panel,
.doc-totals-panel {
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 16px;
  padding: 16px 18px;
  background: rgba(255, 255, 255, 0.78);
  color: var(--doc-text);
}

.doc-terms-panel h3,
.doc-totals-panel h3 {
  margin: 0 0 8px;
  color: var(--doc-text);
  font-size: 11px;
  line-height: 1.25;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.doc-terms-panel p {
  margin: 0;
  color: var(--doc-muted);
  font-size: 10.5px;
  line-height: 1.55;
}

.doc-total-list,
.doc-totals-panel > div {
  display: grid;
  gap: 7px;
  width: 100%;
}

.doc-total-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: baseline;
  color: var(--doc-muted);
  font-size: 11px;
  line-height: 1.35;
}

.doc-total-row strong,
.doc-total-row b,
.doc-total-value {
  color: var(--doc-text);
  font-size: 12px;
  line-height: 1.25;
  font-weight: 700;
  text-align: right;
}

.doc-total-row--grand {
  margin-top: 2px;
  border-top: 1px solid rgba(148, 163, 184, 0.34);
  padding-top: 8px;
}

.doc-total-row--grand strong,
.doc-total-row--grand b,
.doc-total-row--grand .doc-total-value {
  font-size: 13px;
}

.doc-footer {
  border-top: 1px solid var(--doc-border);
  padding-top: 12px;
}

@media (max-width: 640px) {
  .doc-page {
    width: 100%;
    min-height: auto;
  }

  .doc-hero {
    flex-direction: column;
  }

  .doc-customer-header {
    max-width: none;
    text-align: left;
  }

  .doc-grid,
  .doc-closing {
    grid-template-columns: 1fr;
  }
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

const variantCss: Record<DocumentLayoutType, string> = {
  essence: `
.doc-template-essence {
  padding: 22mm;
  background: #ffffff;
}

.doc-template-essence .doc-header {
  border-bottom: 1px solid #eef2f7;
}

.doc-template-essence .doc-hero {
  padding: 0 0 20px;
  border-radius: 0;
  border-bottom: 1px solid #eef2f7;
  background: transparent;
}

.doc-template-essence .doc-hero h1 {
  max-width: 620px;
  font-size: 34px;
}

.doc-template-essence .doc-grid div,
.doc-template-essence .doc-section {
  border-right: 0;
  border-left: 0;
  border-radius: 0;
  padding-right: 0;
  padding-left: 0;
  background: #ffffff;
}

.doc-template-essence .doc-closing {
  gap: 20px;
}

.doc-template-essence .doc-terms-panel,
.doc-template-essence .doc-totals-panel {
  border-right: 0;
  border-left: 0;
  border-radius: 0;
  background: #ffffff;
}

.doc-template-essence .doc-section h2,
.doc-template-essence .doc-terms-panel h3,
.doc-template-essence .doc-totals-panel h3 {
  color: var(--doc-primary);
}
`,

  frame: `
.doc-template-frame {
  padding: 16mm;
  border: 8px solid color-mix(in srgb, var(--doc-primary) 80%, #ffffff);
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}

.doc-template-frame .doc-content {
  display: grid;
  gap: 14px;
}

.doc-template-frame .doc-header,
.doc-template-frame .doc-hero,
.doc-template-frame .doc-section,
.doc-template-frame .doc-terms-panel,
.doc-template-frame .doc-totals-panel {
  border: 1px solid #dbe5f0;
  background: #ffffff;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.045);
}

.doc-template-frame .doc-header {
  border-radius: 18px;
  padding: 16px;
}

.doc-template-frame .doc-hero {
  border-radius: 24px;
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.09), #ffffff 58%);
}

.doc-template-frame .doc-section h2 {
  padding-bottom: 8px;
  border-bottom: 1px solid #e2e8f0;
}
`,

  authority: `
.doc-template-authority {
  padding: 0;
  background: #ffffff;
}

.doc-template-authority::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 88mm;
  background:
    radial-gradient(circle at 86% 12%, rgba(37, 99, 235, 0.3), transparent 28mm),
    linear-gradient(135deg, #0f172a 0%, #111827 58%, #1e3a8a 100%);
  z-index: 0;
}

.doc-template-authority .doc-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.18);
  padding: 30px 20mm;
  background: transparent;
}

.doc-template-authority .doc-content {
  padding: 22px 20mm 18mm;
}

.doc-template-authority .doc-hero {
  margin-top: 0;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 22px;
  padding: 32px 34px;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
}

.doc-template-authority .doc-header,
.doc-template-authority .doc-header p,
.doc-template-authority .doc-header span,
.doc-template-authority .doc-header strong,
.doc-template-authority .doc-hero,
.doc-template-authority .doc-hero h1,
.doc-template-authority .doc-hero p,
.doc-template-authority .doc-hero .doc-kicker,
.doc-template-authority .doc-hero span {
  color: #f8fafc;
}

.doc-template-authority .doc-header .doc-company span,
.doc-template-authority .doc-hero p,
.doc-template-authority .doc-hero .doc-kicker,
.doc-template-authority .doc-hero span {
  color: rgba(248, 250, 252, 0.82);
}

.doc-template-authority .doc-grid {
  margin-top: 18px;
}

.doc-template-authority .doc-grid div {
  border: 0;
  background: #ffffff;
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.11);
}

.doc-template-authority .doc-items,
.doc-template-authority .doc-terms-panel,
.doc-template-authority .doc-totals-panel {
  border-color: #dbeafe;
  background: #ffffff;
  color: var(--doc-text);
}

.doc-template-authority .doc-items *,
.doc-template-authority .doc-closing,
.doc-template-authority .doc-closing * {
  color: inherit;
}

.doc-template-authority .doc-items th,
.doc-template-authority .doc-terms-panel p,
.doc-template-authority .doc-total-row {
  color: var(--doc-muted);
}

.doc-template-authority .doc-items td,
.doc-template-authority .doc-items strong,
.doc-template-authority .doc-terms-panel h3,
.doc-template-authority .doc-totals-panel h3,
.doc-template-authority .doc-total-row strong,
.doc-template-authority .doc-total-row b,
.doc-template-authority .doc-total-value {
  color: var(--doc-text);
}

.doc-template-authority .doc-footer {
  margin: 0 20mm 14mm;
}
`,

  flow: `
.doc-template-flow {
  background: linear-gradient(90deg, rgba(37, 99, 235, 0.055) 0 14mm, #ffffff 14mm 100%);
}

.doc-template-flow::before {
  content: "";
  position: absolute;
  top: 46mm;
  bottom: 22mm;
  left: 12mm;
  width: 2px;
  background: linear-gradient(180deg, var(--doc-primary), rgba(37, 99, 235, 0.08));
}

.doc-template-flow .doc-header {
  border-bottom: 0;
}

.doc-template-flow .doc-hero,
.doc-template-flow .doc-grid,
.doc-template-flow .doc-section,
.doc-template-flow .doc-closing {
  margin-left: 8mm;
}

.doc-template-flow .doc-hero {
  border-left: 5px solid var(--doc-primary);
  border-radius: 18px;
  background: #f8fafc;
}

.doc-template-flow .doc-grid div,
.doc-template-flow .doc-section,
.doc-template-flow .doc-terms-panel,
.doc-template-flow .doc-totals-panel {
  border: 0;
  border-left: 4px solid rgba(37, 99, 235, 0.22);
  background: #ffffff;
  box-shadow: 0 14px 36px rgba(15, 23, 42, 0.055);
}
`,

  orbit: `
.doc-template-orbit {
  background:
    radial-gradient(circle at 85% 8%, rgba(124, 58, 237, 0.18), transparent 42mm),
    radial-gradient(circle at 8% 35%, rgba(37, 99, 235, 0.12), transparent 36mm),
    #ffffff;
}

.doc-template-orbit::before,
.doc-template-orbit::after {
  content: "";
  position: absolute;
  border: 1px solid rgba(124, 58, 237, 0.18);
  border-radius: 999px;
  pointer-events: none;
}

.doc-template-orbit::before {
  width: 120mm;
  height: 120mm;
  top: -50mm;
  right: -44mm;
}

.doc-template-orbit::after {
  width: 72mm;
  height: 72mm;
  top: 14mm;
  right: -22mm;
  border-color: rgba(37, 99, 235, 0.16);
}

.doc-template-orbit .doc-header {
  border-bottom: 0;
}

.doc-template-orbit .doc-hero {
  border: 1px solid rgba(124, 58, 237, 0.18);
  border-radius: 30px;
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.12), rgba(37, 99, 235, 0.05));
}

.doc-template-orbit .doc-grid div {
  border-radius: 999px;
}

.doc-template-orbit .doc-grid div,
.doc-template-orbit .doc-section,
.doc-template-orbit .doc-terms-panel,
.doc-template-orbit .doc-totals-panel {
  border-color: rgba(124, 58, 237, 0.18);
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 18px 44px rgba(76, 29, 149, 0.08);
}

.doc-template-orbit .doc-section h2,
.doc-template-orbit .doc-terms-panel h3,
.doc-template-orbit .doc-totals-panel h3 {
  color: #6d28d9;
}
`,

  pulse: `
.doc-template-pulse {
  padding-top: 14mm;
  background:
    linear-gradient(180deg, rgba(14, 165, 233, 0.09), transparent 45mm),
    #ffffff;
}

.doc-template-pulse .doc-header {
  border-bottom: 5px solid var(--doc-primary);
}

.doc-template-pulse .doc-hero {
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

.doc-template-pulse .doc-hero::after {
  content: "";
  position: absolute;
  right: 24px;
  bottom: 22px;
  width: 92px;
  height: 28px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--doc-primary), #0ea5e9);
  opacity: 0.16;
}

.doc-template-pulse .doc-grid div {
  border: 0;
  border-top: 4px solid var(--doc-primary);
  background: #ffffff;
  box-shadow: 0 16px 38px rgba(14, 165, 233, 0.09);
}

.doc-template-pulse .doc-section,
.doc-template-pulse .doc-terms-panel,
.doc-template-pulse .doc-totals-panel {
  border-color: rgba(14, 165, 233, 0.26);
}

.doc-template-pulse .doc-section h2,
.doc-template-pulse .doc-terms-panel h3,
.doc-template-pulse .doc-totals-panel h3 {
  display: inline-block;
  border-radius: 999px;
  color: #0369a1;
  background: rgba(14, 165, 233, 0.11);
}

.doc-template-pulse .doc-section h2 {
  padding: 5px 10px;
}
`,

  signature: `
.doc-template-signature {
  padding: 24mm;
  background: linear-gradient(90deg, #0f172a 0 12mm, #ffffff 12mm 100%);
}

.doc-template-signature::before {
  content: "";
  position: absolute;
  top: 20mm;
  bottom: 20mm;
  left: 8mm;
  width: 1px;
  background: linear-gradient(180deg, #f59e0b, transparent);
}

.doc-template-signature .doc-header {
  border-bottom: 1px solid rgba(245, 158, 11, 0.28);
  padding-left: 8mm;
}

.doc-template-signature .doc-hero {
  margin-left: 8mm;
  border: 1px solid rgba(245, 158, 11, 0.28);
  border-radius: 26px;
  padding: 30px 34px;
  background:
    radial-gradient(circle at top right, rgba(245, 158, 11, 0.18), transparent 45mm),
    #ffffff;
  box-shadow: 0 22px 60px rgba(15, 23, 42, 0.1);
}

.doc-template-signature .doc-hero h1 {
  margin-top: 10px;
  font-size: 34px;
  font-weight: 500;
}

.doc-template-signature .doc-hero .doc-kicker,
.doc-template-signature .doc-hero span {
  display: inline-block;
  color: #b45309;
}

.doc-template-signature .doc-grid,
.doc-template-signature .doc-section,
.doc-template-signature .doc-closing {
  margin-left: 8mm;
}

.doc-template-signature .doc-grid div,
.doc-template-signature .doc-section,
.doc-template-signature .doc-terms-panel,
.doc-template-signature .doc-totals-panel {
  border-color: rgba(245, 158, 11, 0.24);
  background: #fffaf0;
}

.doc-template-signature .doc-section h2,
.doc-template-signature .doc-terms-panel h3,
.doc-template-signature .doc-totals-panel h3 {
  color: #92400e;
}

.doc-template-signature .doc-footer {
  font-style: italic;
}
`,
};

const templateMeta: Array<{
  name: string;
  type: DocumentLayoutType;
  description: string;
}> = [
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

export const documentLayoutPreviewData = {
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

export function buildDocumentLayoutCssTemplate(type: DocumentLayoutType) {
  return `${sharedCss}\n${variantCss[type]}`;
}

export const systemDocumentLayoutTemplates: SystemDocumentLayoutTemplate[] =
  templateMeta.map((template) => ({
    ...template,
    htmlTemplate: documentLayoutHtmlTemplate,
    cssTemplate: buildDocumentLayoutCssTemplate(template.type),
    previewData: documentLayoutPreviewData,
    isDefault: template.type === 'essence',
    metadata: {
      description: template.description,
      visualVersion: 4,
      visualUpdatedAt: '2026-05-25',
      closingLayout: 'terms_and_totals_two_column_container',
    },
  }));
