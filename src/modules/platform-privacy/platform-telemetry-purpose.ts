// src/modules/platform-privacy/platform-telemetry-purpose.ts
//
// The neutral, platform-wide telemetry purpose (Lyra Social S1.4.8).
//
// WHY A SECOND PURPOSE KEY AND NOT A REUSE OF THE LEADFLOW ONE
// ------------------------------------------------------------
// `leadflow_telemetry_consents` rows are bound to `notice_version` +
// `notice_content_hash`. A `leadflow_product_improvement_v1` row proves
// exactly one thing: that someone, in that scope, accepted *the text they
// were shown*. Its notice body (migration 1788200000000) names the LeadFlow
// product explicitly and describes LeadFlow automation-run counts as the
// contribution — it does not describe a platform-wide scope covering Social.
//
// Treating that row as if it also authorized Social telemetry would be
// re-interpreting an acceptance after the fact: asking permission for X and
// using it as permission for X+Y. The version+hash pair exists precisely to
// make that impossible. So the neutral scope gets its OWN purpose key and
// its OWN notice, and a fresh acceptance is required.
//
// See docs/architecture/social/social-settings-decisions.md D-4 and
// social-settings-architecture.md §8.1.
//
// NO MIGRATION IS NEEDED FOR THIS (S1.4.8 §21 / D-14)
// ---------------------------------------------------
// `leadflow_telemetry_consent_notices.purpose_key` and
// `leadflow_telemetry_consents.purpose_key` are plain `varchar(80)` columns
// with no CHECK constraint and no enum type; the notices table's unique
// index is `(purpose_key, version, locale)`. A second purpose key is
// therefore new *data*, not new *schema*. The row is seeded idempotently at
// application bootstrap (`PlatformTelemetryNoticeSeedService`), following
// the precedent already set by `HelpCenterSeedService` for platform-owned
// global registry content.

import { createHash } from 'node:crypto';

/** Legacy, LeadFlow-scoped purpose. Never written by the neutral surface. */
export const LEADFLOW_PRODUCT_TELEMETRY_PURPOSE =
  'leadflow_product_improvement_v1';

/** Neutral, platform-scoped purpose. All new shared consents use this. */
export const PLATFORM_PRODUCT_TELEMETRY_PURPOSE =
  'platform_product_improvement_v1';

export const PLATFORM_TELEMETRY_PURPOSE_DESCRIPTION =
  'Melhorar a confiabilidade e o desempenho dos produtos da plataforma Lyra usando somente contagens operacionais estruturadas e agregadas.';

export const PLATFORM_TELEMETRY_NOTICE_LOCALE = 'pt-BR';

/**
 * Version 1: the original neutral text, seeded `legal_review_status:
 * 'pending'` and never accepted by anyone (S1.4.8). Its constants stay
 * exactly as shipped — D-4 forbids rewriting a version in place — and the
 * seed service never advances past it on its own; `PLATFORM_TELEMETRY_NOTICE_VERSION`
 * below is what a caller resolves against, and I6.2 moves it forward.
 */
export const PLATFORM_TELEMETRY_NOTICE_V1_TITLE =
  'Telemetria agregada para melhoria dos produtos Lyra';

export const PLATFORM_TELEMETRY_NOTICE_V1_BODY =
  'Finalidade técnica: permitir que a Lyra use métricas operacionais estruturadas para melhorar a confiabilidade e o desempenho dos produtos da plataforma Lyra que você utiliza, incluindo o LeadFlow e o Lyra Social. A contribuição inclui somente contagens diárias agregadas de eventos operacionais. Não inclui conteúdo de mensagens, dados de contatos, anexos, prompts, credenciais, criativos nem payloads de provedores. Os identificadores do contexto ficam separados dos fatos por um pseudônimo aleatório. Resultados de produto só são disponibilizados em grupos com pelo menos 5 contextos. A retenção técnica inicial dos fatos é de 90 dias. Você pode desativar novas coletas a qualquer momento e solicitar a exclusão da contribuição pseudonimizada. Esta escolha é opcional: recusar não altera nenhuma funcionalidade contratada. Este texto técnico requer revisão jurídica antes do rollout de produção.';

export const PLATFORM_TELEMETRY_NOTICE_V1_CATEGORIES = [
  'automation_live_terminal_runs',
  'automation_live_failed_runs',
];

/**
 * Version 2: the I6.2 provisional Anonymous Benchmark notice.
 *
 * Seeded `legal_review_status: 'provisional'` rather than `'pending'` —
 * `isNoticeClearedForConsent` treats that the same as `'approved'` for both
 * `optIn` and `collectSnapshot` (I6.2 decision), so this text is what a user
 * can actually accept today. It is not a substitute for formal legal
 * clearance; the closing paragraph says so, and flipping to `'approved'`
 * remains the separate, non-code legal decision it always was.
 *
 * Every categories entry below is a real `BenchmarkMetricKey` from
 * `common/intelligence/intelligence-benchmark.ts` plus the Business Mode
 * dimension — checked against the I6/I6.1 contribution code before this text
 * was written, not assumed from the product description. What the body says
 * is NOT contributed (message content, contact data, phone/email, campaign or
 * ad names, raw tenant/account/campaign/ad-set/ad identifiers) matches the
 * forbidden-identifier list in `benchmark.boundary.spec` and
 * `paid-media-contribution.adapter.ts` exactly.
 */
export const PLATFORM_TELEMETRY_NOTICE_VERSION = 2;

export const PLATFORM_TELEMETRY_NOTICE_TITLE =
  'Contribuição anônima para melhorar o Lyra';

export const PLATFORM_TELEMETRY_NOTICE_BODY =
  'O Lyra pode usar dados estatísticos e agregados da operação para melhorar análises, benchmarks e recursos de inteligência da plataforma.\n\nQuando esta opção estiver ativada, podemos processar métricas operacionais como investimento em mídia, impressões, cliques, leads reportados pelas plataformas de anúncios e informações gerais sobre o tipo de negócio configurado.\n\nAntes de qualquer contribuição ser utilizada para aprendizado agregado, o contexto da empresa é substituído por um identificador aleatório. Os dados enviados para essa camada não incluem nomes de clientes, contatos, conteúdo de mensagens, telefones, e-mails, nomes de campanhas ou anúncios, nem os identificadores originais da empresa, contas de anúncios, campanhas, conjuntos de anúncios ou anúncios.\n\nOs benchmarks somente são disponibilizados quando existe uma quantidade mínima de empresas participantes suficiente para preservar o anonimato. Atualmente, o Lyra exige pelo menos 5 contextos independentes em uma mesma comparação.\n\nOs resultados são apresentados apenas de forma agregada, como medianas, faixas percentuais e quantidade de participantes elegíveis. O Lyra não revela quais empresas participaram de uma comparação.\n\nEsta contribuição é opcional. Não aceitar não limita o funcionamento do Lyra, do LeadFlow, do Social ou das análises operacionais da sua própria empresa.\n\nVocê pode retirar este consentimento posteriormente. Após a revogação, novas contribuições deixam de ser realizadas, e os dados associados à contribuição podem ser removidos conforme as políticas de retenção e exclusão da plataforma.\n\nEste consentimento se aplica somente à empresa ou contexto atualmente selecionado. Caso você tenha acesso a mais de uma empresa, cada uma possui seu próprio consentimento.\n\nEste texto é provisório e poderá ser atualizado antes do lançamento comercial do Lyra. Quando houver alteração relevante no conteúdo do consentimento, uma nova aceitação poderá ser solicitada.';

export const PLATFORM_TELEMETRY_NOTICE_CTA =
  'Li e concordo · Contribuir anonimamente para melhorar o Lyra';

export const PLATFORM_TELEMETRY_NOTICE_SUPPORTING_COPY =
  'Opcional. Sua decisão não interfere no uso dos produtos contratados.';

export const PLATFORM_TELEMETRY_NOTICE_CATEGORIES = [
  'paid_spend_minor_units',
  'paid_impressions',
  'paid_clicks',
  'paid_link_clicks',
  'paid_provider_leads',
  'business_mode_dimension',
];

export const PLATFORM_TELEMETRY_NOTICE_RETENTION_DAYS = 90;
export const PLATFORM_TELEMETRY_NOTICE_K_ANONYMITY = 5;

/**
 * sha256 of a notice body — the same function used for every version,
 * including v1's already-seeded row. Never a hardcoded literal (S1.4.8 §21):
 * the hash must always be a function of the exact text, so an accidental
 * whitespace edit is caught rather than silently shipped as an unchanged hash.
 */
function contentHashOf(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

/** The hash of the seeded, unmodifiable version 1 body. */
export function platformTelemetryNoticeV1ContentHash(): string {
  return contentHashOf(PLATFORM_TELEMETRY_NOTICE_V1_BODY);
}

/** The hash of the current version's body — what a new seed writes. */
export function platformTelemetryNoticeContentHash(): string {
  return contentHashOf(PLATFORM_TELEMETRY_NOTICE_BODY);
}
