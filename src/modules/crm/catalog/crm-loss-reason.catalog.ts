import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';

/**
 * Standardised reasons a lead is lost, offered per Business Mode.
 *
 * A free-typed loss reason is unusable downstream: two operators write "sem
 * verba" and "orçamento curto" and Analytics can never count them together.
 * This catalog gives the lost transition and the opportunity's `lostReason` a
 * finite, stable vocabulary — shared reasons that apply to any business, plus a
 * short mode-specific set for the ones a segment actually says out loud.
 *
 * Codes are stable slugs; only labels are translated. A code, once shipped, is
 * a promise to whoever aggregates on it, so it is never renamed in place.
 */
export type CrmLossReason = {
  /** Stable machine code. Stored on the policy and the opportunity. */
  code: string;
  /** Operator-facing name. */
  label: string;
  /** Whether it applies to every Business Mode or only a specific one. */
  scope: 'shared' | 'business_mode';
};

/** Reasons any business loses a deal for. Offered in every Business Mode. */
export const CRM_SHARED_LOSS_REASONS: readonly CrmLossReason[] = [
  reason('price_too_high', 'Preço acima do esperado'),
  reason('no_budget', 'Sem orçamento no momento'),
  reason('chose_competitor', 'Escolheu um concorrente'),
  reason('no_response', 'Parou de responder'),
  reason('not_qualified', 'Fora do perfil'),
  reason('bad_timing', 'Momento inadequado'),
  reason('no_longer_interested', 'Perdeu o interesse'),
  reason('duplicate_lead', 'Lead duplicado'),
];

/** Reasons that only make sense inside one segment. */
export const CRM_LOSS_REASONS_BY_MODE: Partial<
  Record<LeadFlowBusinessMode, readonly CrmLossReason[]>
> = {
  [LeadFlowBusinessMode.AgencyServices]: modeReasons([
    ['no_decision_maker', 'Sem acesso ao decisor'],
    ['scope_mismatch', 'Escopo incompatível'],
    ['in_house_solution', 'Vai resolver internamente'],
  ]),
  [LeadFlowBusinessMode.LocalServices]: modeReasons([
    ['out_of_service_area', 'Fora da área de atendimento'],
    ['scheduling_conflict', 'Conflito de agenda'],
  ]),
  [LeadFlowBusinessMode.ClinicsEsthetics]: modeReasons([
    ['procedure_not_offered', 'Procedimento não oferecido'],
    ['scheduling_conflict', 'Conflito de agenda'],
    ['medical_contraindication', 'Contraindicação clínica'],
  ]),
  [LeadFlowBusinessMode.RestaurantsFood]: modeReasons([
    ['date_unavailable', 'Data indisponível'],
    ['capacity_exceeded', 'Capacidade excedida'],
  ]),
  [LeadFlowBusinessMode.RealEstate]: modeReasons([
    ['financing_denied', 'Financiamento negado'],
    ['property_unavailable', 'Imóvel indisponível'],
    ['location_mismatch', 'Região não atende'],
  ]),
  [LeadFlowBusinessMode.EducationCourses]: modeReasons([
    ['course_unavailable', 'Curso ou turma indisponível'],
    ['schedule_conflict', 'Conflito de horário'],
    ['prerequisites_not_met', 'Pré-requisitos não atendidos'],
  ]),
  [LeadFlowBusinessMode.Automotive]: modeReasons([
    ['vehicle_unavailable', 'Veículo indisponível'],
    ['financing_denied', 'Financiamento negado'],
    ['trade_in_valuation', 'Avaliação da troca insuficiente'],
  ]),
  [LeadFlowBusinessMode.RetailStore]: modeReasons([
    ['product_unavailable', 'Produto indisponível'],
    ['price_mismatch', 'Preço fora do esperado'],
  ]),
  [LeadFlowBusinessMode.EcommerceLight]: modeReasons([
    ['product_unavailable', 'Produto indisponível'],
    ['shipping_cost', 'Custo de frete'],
    ['delivery_time', 'Prazo de entrega'],
  ]),
  [LeadFlowBusinessMode.EventsTourism]: modeReasons([
    ['date_unavailable', 'Data indisponível'],
    ['capacity_exceeded', 'Capacidade excedida'],
    ['budget_mismatch', 'Orçamento incompatível'],
  ]),
  [LeadFlowBusinessMode.LegalAccounting]: modeReasons([
    ['outside_practice_area', 'Fora da área de atuação'],
    ['conflict_of_interest', 'Conflito de interesse'],
    ['statute_expired', 'Prazo legal esgotado'],
  ]),
  [LeadFlowBusinessMode.FitnessWellness]: modeReasons([
    ['schedule_conflict', 'Conflito de horário'],
    ['location_mismatch', 'Localização não atende'],
    ['medical_restriction', 'Restrição médica'],
  ]),
};

/**
 * The loss reasons offered for a Business Mode: its own first, then the shared
 * ones, deduplicated by code. An unknown or absent mode still gets the shared
 * set, so the lost flow is never left without a vocabulary.
 */
export function resolveCrmLossReasons(
  businessModeKey: string | null | undefined,
): CrmLossReason[] {
  const specific =
    (businessModeKey &&
      CRM_LOSS_REASONS_BY_MODE[businessModeKey as LeadFlowBusinessMode]) ||
    [];
  const merged: CrmLossReason[] = [];
  const seen = new Set<string>();
  for (const item of [...specific, ...CRM_SHARED_LOSS_REASONS]) {
    if (seen.has(item.code)) continue;
    seen.add(item.code);
    merged.push(item);
  }
  return merged;
}

function reason(code: string, label: string): CrmLossReason {
  return { code, label, scope: 'shared' };
}

function modeReasons(
  entries: Array<[string, string]>,
): readonly CrmLossReason[] {
  return entries.map(([code, label]) => ({
    code,
    label,
    scope: 'business_mode' as const,
  }));
}
