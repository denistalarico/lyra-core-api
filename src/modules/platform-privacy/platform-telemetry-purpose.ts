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
export const PLATFORM_TELEMETRY_NOTICE_VERSION = 1;

export const PLATFORM_TELEMETRY_NOTICE_TITLE =
  'Telemetria agregada para melhoria dos produtos Lyra';

/**
 * The neutral notice body. It states the platform-wide scope explicitly —
 * this is the text whose acceptance authorizes both LeadFlow and Social, and
 * the reason a legacy LeadFlow acceptance cannot stand in for it.
 *
 * Every factual claim here is one the code actually enforces:
 *  - only structured counts are written (`leadflow_product_telemetry_daily`
 *    stores `metric_key` + integer `metric_value`, never free text);
 *  - the scope identifier is separated from the facts by a random pseudonym
 *    (`leadflow_telemetry_identity_links.scope_pseudonym`);
 *  - product-facing aggregates suppress groups below the k-anonymity floor
 *    (`getProductAggregates` HAVING COUNT(DISTINCT scope_pseudonym) >= k);
 *  - retention is enforced by `enforceRetention()`;
 *  - opt-out stops new collection and erasure deletes the contribution.
 *
 * Changing this text changes `contentHash`, which by design invalidates
 * existing acceptances of version 1 (they surface as `requiresRenewal`).
 * A wording change must therefore ship as a NEW version, never as an edit
 * to version 1.
 */
export const PLATFORM_TELEMETRY_NOTICE_BODY =
  'Finalidade técnica: permitir que a Lyra use métricas operacionais estruturadas para melhorar a confiabilidade e o desempenho dos produtos da plataforma Lyra que você utiliza, incluindo o LeadFlow e o Lyra Social. A contribuição inclui somente contagens diárias agregadas de eventos operacionais. Não inclui conteúdo de mensagens, dados de contatos, anexos, prompts, credenciais, criativos nem payloads de provedores. Os identificadores do contexto ficam separados dos fatos por um pseudônimo aleatório. Resultados de produto só são disponibilizados em grupos com pelo menos 5 contextos. A retenção técnica inicial dos fatos é de 90 dias. Você pode desativar novas coletas a qualquer momento e solicitar a exclusão da contribuição pseudonimizada. Esta escolha é opcional: recusar não altera nenhuma funcionalidade contratada. Este texto técnico requer revisão jurídica antes do rollout de produção.';

export const PLATFORM_TELEMETRY_NOTICE_CATEGORIES = [
  'automation_live_terminal_runs',
  'automation_live_failed_runs',
];

export const PLATFORM_TELEMETRY_NOTICE_RETENTION_DAYS = 90;
export const PLATFORM_TELEMETRY_NOTICE_K_ANONYMITY = 5;

/**
 * The same hash the migration computes for the legacy notice: sha256 of the
 * body. The consent row stores it so that any later edit of the text is
 * detectable rather than silently inherited.
 */
export function platformTelemetryNoticeContentHash(): string {
  return createHash('sha256')
    .update(PLATFORM_TELEMETRY_NOTICE_BODY)
    .digest('hex');
}
