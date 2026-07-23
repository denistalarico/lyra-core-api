import { Injectable } from '@nestjs/common';
import type { LeadFlowAutomationRecipeCatalogItem } from '../catalog/automation-recipes.catalog';
import type { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import {
  LeadFlowAutomationRunStatus,
  LeadFlowAutomationSkipReason,
} from '../enums/leadflow-automation-run.enums';
import {
  LeadFlowAutomationContextSignal,
  type LeadFlowAutomationContextGap,
  type LeadFlowAutomationContextGapMap,
  type LeadFlowAutomationContextGapRecord,
} from '../types/leadflow-automation-context.types';

/**
 * Signals the conditions are evaluated against.
 *
 * Values arrive already established by the context resolver, which records
 * where each one came from. Nothing is defaulted here: a signal absent from
 * this object was not observed, and the matching gap says why.
 */
export interface LeadFlowAutomationEvaluationContext {
  leadScore?: number;
  leadReplied?: boolean;
  handoffActive?: boolean;
  insideBusinessHours?: boolean;
  attemptsSoFar?: number;
  hoursSinceLastRun?: number;
  matchedKeywords?: string[];
  matchedIntents?: string[];
  /** Fields already known about the lead — used by the data-quality recipes. */
  presentFields?: string[];
}

export interface LeadFlowAutomationEvaluationCheck {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
  /**
   * Set when the check could not be evaluated at all. Distinguishes "the answer
   * is no" from "there was no answer to read", which the operator needs in
   * order to know whether to fix the configuration or wait for the platform.
   */
  gap?: LeadFlowAutomationContextGap;
}

export interface LeadFlowAutomationEvaluation {
  /** True when every condition was evaluated and passed. */
  wouldAct: boolean;
  status: LeadFlowAutomationRunStatus;
  skipReason: LeadFlowAutomationSkipReason | null;
  checks: LeadFlowAutomationEvaluationCheck[];
  plannedActions: string[];
  /** Only the signals actually established, so the result is reproducible. */
  context: LeadFlowAutomationEvaluationContext;
  /** Required signals that could not be established, with the reason. */
  gaps: LeadFlowAutomationContextGapRecord[];
}

/**
 * Catalog data actually consulted by the deterministic evaluator. Keeping this
 * narrow lets a published runtime reconstruct the decision inputs from its
 * immutable snapshot instead of silently inheriting a newer catalog revision.
 */
export type LeadFlowAutomationEvaluationRecipe = Pick<
  LeadFlowAutomationRecipeCatalogItem,
  'businessModeKeys' | 'primaryAction'
>;

/** Which run outcome each context gap produces. */
const GAP_SKIP_REASONS: Record<
  LeadFlowAutomationContextGap,
  LeadFlowAutomationSkipReason
> = {
  dependency_unavailable: LeadFlowAutomationSkipReason.DependencyUnavailable,
  ambiguous_context: LeadFlowAutomationSkipReason.AmbiguousContext,
  stale_context: LeadFlowAutomationSkipReason.StaleContext,
  missing_context: LeadFlowAutomationSkipReason.MissingContext,
};

/** Most severe first, so the reported reason is the one that blocks hardest. */
const GAP_PRECEDENCE: LeadFlowAutomationContextGap[] = [
  'dependency_unavailable',
  'ambiguous_context',
  'stale_context',
  'missing_context',
];

/**
 * Deterministic evaluation of an automation's conditions.
 *
 * Pure: reads the stored configuration and an already-resolved context, returns
 * a decision. It performs no I/O and requests no effects, which is what lets
 * the dry-run endpoint be genuinely side-effect free.
 *
 * Fail-closed by construction. A condition whose signal was not established
 * does not quietly pass, and does not fall back to a plausible value — it fails
 * with the gap that prevented it. Substituting a default here is how a
 * threshold ends up satisfying itself: a minimum score compared against a score
 * invented from that same minimum will always pass, and the automation will
 * report that it would act on a lead nobody ever measured.
 */
@Injectable()
export class LeadFlowAutomationEvaluationService {
  evaluate(
    automation: LeadFlowAutomationEntity,
    recipe: LeadFlowAutomationEvaluationRecipe | undefined,
    input: LeadFlowAutomationEvaluationContext = {},
    gaps: LeadFlowAutomationContextGapMap = {},
  ): LeadFlowAutomationEvaluation {
    const conditions = automation.conditionConfig ?? {};
    const actions = automation.actionConfig ?? {};
    const schedule = automation.schedulePolicy ?? {};

    const context: LeadFlowAutomationEvaluationContext = { ...input };
    const gapRecords = Object.values(gaps);
    const checks: LeadFlowAutomationEvaluationCheck[] = [];

    let conditionReason: LeadFlowAutomationSkipReason | null = null;
    let blockingGap: LeadFlowAutomationContextGap | null = null;

    /** Records a check whose signal was established. */
    const check = (
      key: string,
      label: string,
      passed: boolean,
      detail: string,
      reason: LeadFlowAutomationSkipReason,
    ): void => {
      checks.push({ key, label, passed, detail });
      if (!passed && conditionReason === null) {
        conditionReason = reason;
      }
    };

    /**
     * Records a check that could not be evaluated. Returns true when the caller
     * must stop, so a missing signal never falls through to a comparison
     * against an assumed value.
     */
    const blocked = (
      key: string,
      label: string,
      signal: LeadFlowAutomationContextSignal,
    ): boolean => {
      const record = gaps[signal];
      if (!record) return false;
      checks.push({
        key,
        label,
        passed: false,
        detail: record.detail,
        gap: record.gap,
      });
      if (
        blockingGap === null ||
        GAP_PRECEDENCE.indexOf(record.gap) < GAP_PRECEDENCE.indexOf(blockingGap)
      ) {
        blockingGap = record.gap;
      }
      return true;
    };

    if (!recipe) {
      return this.unknownRecipe(context, gapRecords);
    }

    // --- business mode ----------------------------------------------------
    check(
      'businessMode',
      'Business Mode compatível',
      automation.businessModeKey === recipe.businessModeKeys ||
        recipe.businessModeKeys === 'all' ||
        (Array.isArray(recipe.businessModeKeys) &&
          recipe.businessModeKeys.includes(
            automation.businessModeKey as never,
          )),
      `Business Mode ativo: ${automation.businessModeKey}.`,
      LeadFlowAutomationSkipReason.UnsupportedBusinessMode,
    );

    // --- window and cancellation signals -----------------------------------
    if (conditions.businessHoursOnly === true) {
      const label = 'Dentro do horário comercial';
      if (
        !blocked(
          'businessHoursOnly',
          label,
          LeadFlowAutomationContextSignal.InsideBusinessHours,
        )
      ) {
        const inside = context.insideBusinessHours === true;
        check(
          'businessHoursOnly',
          label,
          inside,
          inside
            ? 'A mensagem chegaria dentro da janela permitida.'
            : 'Fora da janela: a ação seria adiada ou cancelada.',
          LeadFlowAutomationSkipReason.OutsideBusinessHours,
        );
      }
    }

    if (conditions.stopIfReplied === true) {
      const label = 'Lead ainda não respondeu';
      if (
        !blocked(
          'stopIfReplied',
          label,
          LeadFlowAutomationContextSignal.LeadReplied,
        )
      ) {
        const replied = context.leadReplied === true;
        check(
          'stopIfReplied',
          label,
          !replied,
          replied
            ? 'O lead respondeu: a automação seria cancelada.'
            : 'Sem resposta do lead até aqui.',
          LeadFlowAutomationSkipReason.LeadReplied,
        );
      }
    }

    if (conditions.stopIfHandoff === true) {
      const label = 'Sem atendimento humano em curso';
      if (
        !blocked(
          'stopIfHandoff',
          label,
          LeadFlowAutomationContextSignal.HandoffActive,
        )
      ) {
        const handoff = context.handoffActive === true;
        check(
          'stopIfHandoff',
          label,
          !handoff,
          handoff
            ? 'Há handoff ativo: a automação seria cancelada.'
            : 'Nenhum handoff ativo.',
          LeadFlowAutomationSkipReason.HandoffInProgress,
        );
      }
    }

    // --- qualification -----------------------------------------------------
    const minScore =
      typeof conditions.minScore === 'number' ? conditions.minScore : null;
    if (minScore !== null) {
      const label = 'Pontuação mínima atingida';
      if (
        !blocked('minScore', label, LeadFlowAutomationContextSignal.LeadScore)
      ) {
        const score = context.leadScore;
        // Never compare against an assumed score: without a measured value the
        // only honest answer is that the condition could not be checked.
        if (typeof score !== 'number') {
          checks.push({
            key: 'minScore',
            label,
            passed: false,
            detail:
              'A pontuação do lead não pôde ser obtida, então o mínimo não foi verificado.',
            gap: 'missing_context',
          });
          blockingGap ??= 'missing_context';
        } else {
          check(
            'minScore',
            label,
            score >= minScore,
            `Pontuação ${score} contra o mínimo de ${minScore}.`,
            LeadFlowAutomationSkipReason.ScoreBelowThreshold,
          );
        }
      }
    }

    const keywords = this.stringList(conditions.keywords);
    if (keywords.length > 0) {
      const label = 'Palavra-chave encontrada';
      if (
        !blocked(
          'keywords',
          label,
          LeadFlowAutomationContextSignal.MatchedKeywords,
        )
      ) {
        const matched = (context.matchedKeywords ?? []).filter((item) =>
          keywords.includes(item),
        );
        check(
          'keywords',
          label,
          matched.length > 0,
          matched.length > 0
            ? `Encontradas: ${matched.join(', ')}.`
            : 'Nenhuma das palavras-chave configuradas apareceu.',
          LeadFlowAutomationSkipReason.ConditionNotMet,
        );
      }
    }

    const intents = this.stringList(conditions.intents);
    if (intents.length > 0) {
      const label = 'Intenção reconhecida';
      if (
        !blocked(
          'intents',
          label,
          LeadFlowAutomationContextSignal.MatchedIntents,
        )
      ) {
        const matched = (context.matchedIntents ?? []).filter((item) =>
          intents.includes(item),
        );
        check(
          'intents',
          label,
          matched.length > 0,
          matched.length > 0
            ? `Reconhecidas: ${matched.join(', ')}.`
            : 'Nenhuma das intenções configuradas foi reconhecida.',
          LeadFlowAutomationSkipReason.ConditionNotMet,
        );
      }
    }

    // Data-quality recipes act when something is MISSING, so the check passes
    // when at least one required field is absent. That makes an unknown field
    // list especially dangerous: treating "I could not read the record" as "the
    // record is empty" would fire a request for data the lead already gave.
    const requiredFields = this.stringList(conditions.requiredFields);
    if (requiredFields.length > 0) {
      const label = 'Há campos pendentes a cobrar';
      if (
        !blocked(
          'requiredFields',
          label,
          LeadFlowAutomationContextSignal.PresentFields,
        )
      ) {
        const present = context.presentFields;
        if (!Array.isArray(present)) {
          checks.push({
            key: 'requiredFields',
            label,
            passed: false,
            detail:
              'Os campos já preenchidos não puderam ser lidos, então não é possível saber o que falta.',
            gap: 'missing_context',
          });
          blockingGap ??= 'missing_context';
        } else {
          const missing = requiredFields.filter(
            (field) => !present.includes(field),
          );
          check(
            'requiredFields',
            label,
            missing.length > 0,
            missing.length > 0
              ? `Pendentes: ${missing.join(', ')}.`
              : 'Todos os campos obrigatórios já estão preenchidos.',
            LeadFlowAutomationSkipReason.ConditionNotMet,
          );
        }
      }
    }

    // --- rate limits -------------------------------------------------------
    const maxAttempts =
      typeof actions.maxAttempts === 'number' ? actions.maxAttempts : null;
    if (maxAttempts !== null) {
      const label = 'Dentro do limite de tentativas';
      if (
        !blocked(
          'maxAttempts',
          label,
          LeadFlowAutomationContextSignal.AttemptsSoFar,
        )
      ) {
        const attempts = context.attemptsSoFar;
        if (typeof attempts !== 'number') {
          checks.push({
            key: 'maxAttempts',
            label,
            passed: false,
            detail:
              'O número de tentativas já feitas não pôde ser apurado, então o limite não foi verificado.',
            gap: 'missing_context',
          });
          blockingGap ??= 'missing_context';
        } else {
          check(
            'maxAttempts',
            label,
            attempts < maxAttempts,
            `${attempts} de ${maxAttempts} tentativas usadas.`,
            LeadFlowAutomationSkipReason.AttemptLimitReached,
          );
        }
      }
    }

    const cooldownHours =
      typeof schedule.cooldownHours === 'number'
        ? schedule.cooldownHours
        : null;
    if (cooldownHours !== null && cooldownHours > 0) {
      const label = 'Intervalo mínimo respeitado';
      if (
        !blocked(
          'cooldown',
          label,
          LeadFlowAutomationContextSignal.HoursSinceLastRun,
        )
      ) {
        const elapsed = context.hoursSinceLastRun;
        if (typeof elapsed !== 'number') {
          checks.push({
            key: 'cooldown',
            label,
            passed: false,
            detail:
              'O tempo desde a última execução não pôde ser apurado, então o intervalo mínimo não foi verificado.',
            gap: 'missing_context',
          });
          blockingGap ??= 'missing_context';
        } else {
          check(
            'cooldown',
            label,
            elapsed >= cooldownHours,
            `${elapsed}h desde a última execução, mínimo de ${cooldownHours}h.`,
            LeadFlowAutomationSkipReason.CooldownActive,
          );
        }
      }
    }

    const wouldAct = checks.every((item) => item.passed);
    // A condition that failed on an observed value outranks a gap: the lead
    // really did reply, so no amount of further reading would change the
    // outcome. A gap is only the headline reason when nothing else definitively
    // said no — that is the case where resolving context might have let the
    // automation act, and therefore the case worth reporting as unresolved.
    const skipReason = wouldAct
      ? null
      : (conditionReason ??
        (blockingGap !== null ? GAP_SKIP_REASONS[blockingGap] : null));

    return {
      wouldAct,
      status: wouldAct
        ? LeadFlowAutomationRunStatus.Succeeded
        : LeadFlowAutomationRunStatus.Skipped,
      skipReason,
      checks,
      plannedActions: wouldAct ? this.plannedActions(automation, recipe) : [],
      context,
      gaps: gapRecords,
    };
  }

  /** Actions the automation would request, in order. */
  private plannedActions(
    automation: LeadFlowAutomationEntity,
    recipe: LeadFlowAutomationEvaluationRecipe,
  ): string[] {
    const actions = automation.actionConfig ?? {};
    const crmPolicy = automation.crmPolicy ?? {};
    const primary =
      typeof actions.primaryAction === 'string'
        ? actions.primaryAction
        : recipe.primaryAction;

    const planned = [primary];

    if (this.stringList(crmPolicy.addTags).length > 0) {
      planned.push('add_tag');
    }
    if (crmPolicy.appendNote === true) {
      planned.push('append_note');
    }
    if (crmPolicy.updateScore === true) {
      planned.push('update_opportunity_score');
    }
    if (
      typeof crmPolicy.moveStageOnComplete === 'string' &&
      typeof crmPolicy.moveStageReasonCode === 'string'
    ) {
      planned.push('move_opportunity_stage');
    }
    if (
      typeof crmPolicy.transferToPipelineRef === 'string' &&
      typeof crmPolicy.transferToStageRef === 'string' &&
      typeof crmPolicy.transferReasonCode === 'string'
    ) {
      planned.push('transfer_opportunity_pipeline');
    }
    if (
      typeof crmPolicy.copyToPipelineRef === 'string' &&
      typeof crmPolicy.copyToStageRef === 'string' &&
      typeof crmPolicy.copyReasonCode === 'string'
    ) {
      planned.push('copy_opportunity');
    }

    return [...new Set(planned)];
  }

  private unknownRecipe(
    context: LeadFlowAutomationEvaluationContext,
    gaps: LeadFlowAutomationContextGapRecord[],
  ): LeadFlowAutomationEvaluation {
    return {
      wouldAct: false,
      status: LeadFlowAutomationRunStatus.Skipped,
      skipReason: LeadFlowAutomationSkipReason.IncompleteConfiguration,
      checks: [
        {
          key: 'recipe',
          label: 'Receita existe no catálogo',
          passed: false,
          detail: 'A receita desta automação não existe mais no catálogo.',
        },
      ],
      plannedActions: [],
      context,
      gaps,
    };
  }

  private stringList(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }
}
