import { Injectable } from '@nestjs/common';
import type { LeadFlowAutomationRecipeCatalogItem } from '../catalog/automation-recipes.catalog';
import type { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import {
  LeadFlowAutomationRunStatus,
  LeadFlowAutomationSkipReason,
} from '../enums/leadflow-automation-run.enums';

/**
 * Signals the conditions are evaluated against.
 *
 * For a dry-run the operator supplies these (or accepts the defaults). When the
 * execution engine arrives it will build the same shape from real state — which
 * is the point: the decision logic is written once, here, and the engine
 * inherits it instead of reimplementing the rules slightly differently.
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
}

export interface LeadFlowAutomationEvaluation {
  /** True when every condition passes and the automation would act. */
  wouldAct: boolean;
  status: LeadFlowAutomationRunStatus;
  skipReason: LeadFlowAutomationSkipReason | null;
  checks: LeadFlowAutomationEvaluationCheck[];
  plannedActions: string[];
  /** Resolved context actually used, so the result is reproducible. */
  context: Required<
    Omit<
      LeadFlowAutomationEvaluationContext,
      'matchedKeywords' | 'matchedIntents' | 'presentFields'
    >
  > & {
    matchedKeywords: string[];
    matchedIntents: string[];
    presentFields: string[];
  };
}

/**
 * A plausible "the trigger just fired" situation.
 *
 * Chosen so a correctly configured automation reports "would act" by default —
 * that makes the dry-run useful for validating configuration. The operator
 * flips individual signals to explore the cancellation paths.
 */
const DEFAULT_CONTEXT = {
  leadReplied: false,
  handoffActive: false,
  insideBusinessHours: true,
  attemptsSoFar: 0,
  hoursSinceLastRun: 24 * 365,
};

/**
 * Deterministic evaluation of an automation's conditions.
 *
 * Pure: reads the stored configuration and a context, returns a decision. It
 * performs no I/O and requests no effects, which is what lets the dry-run
 * endpoint be genuinely side-effect free rather than a static placeholder.
 */
@Injectable()
export class LeadFlowAutomationEvaluationService {
  evaluate(
    automation: LeadFlowAutomationEntity,
    recipe: LeadFlowAutomationRecipeCatalogItem | undefined,
    input: LeadFlowAutomationEvaluationContext = {},
  ): LeadFlowAutomationEvaluation {
    const conditions = automation.conditionConfig ?? {};
    const actions = automation.actionConfig ?? {};
    const schedule = automation.schedulePolicy ?? {};

    const minScore =
      typeof conditions.minScore === 'number' ? conditions.minScore : null;

    const context = {
      ...DEFAULT_CONTEXT,
      // Default the score to exactly the threshold so it passes; an operator
      // exploring rejection sets it explicitly.
      leadScore: input.leadScore ?? minScore ?? 0,
      leadReplied: input.leadReplied ?? DEFAULT_CONTEXT.leadReplied,
      handoffActive: input.handoffActive ?? DEFAULT_CONTEXT.handoffActive,
      insideBusinessHours:
        input.insideBusinessHours ?? DEFAULT_CONTEXT.insideBusinessHours,
      attemptsSoFar: input.attemptsSoFar ?? DEFAULT_CONTEXT.attemptsSoFar,
      hoursSinceLastRun:
        input.hoursSinceLastRun ?? DEFAULT_CONTEXT.hoursSinceLastRun,
      matchedKeywords: input.matchedKeywords ?? [],
      matchedIntents: input.matchedIntents ?? [],
      presentFields: input.presentFields ?? [],
    };

    const checks: LeadFlowAutomationEvaluationCheck[] = [];
    let skipReason: LeadFlowAutomationSkipReason | null = null;

    /** Records a check and keeps the first failure as the reported reason. */
    const check = (
      key: string,
      label: string,
      passed: boolean,
      detail: string,
      reason: LeadFlowAutomationSkipReason,
    ): void => {
      checks.push({ key, label, passed, detail });
      if (!passed && skipReason === null) {
        skipReason = reason;
      }
    };

    if (!recipe) {
      return this.unknownRecipe(context);
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
      check(
        'businessHoursOnly',
        'Dentro do horário comercial',
        context.insideBusinessHours,
        context.insideBusinessHours
          ? 'A mensagem chegaria dentro da janela permitida.'
          : 'Fora da janela: a ação seria adiada ou cancelada.',
        LeadFlowAutomationSkipReason.OutsideBusinessHours,
      );
    }

    if (conditions.stopIfReplied === true) {
      check(
        'stopIfReplied',
        'Lead ainda não respondeu',
        !context.leadReplied,
        context.leadReplied
          ? 'O lead respondeu: a automação seria cancelada.'
          : 'Sem resposta do lead até aqui.',
        LeadFlowAutomationSkipReason.LeadReplied,
      );
    }

    if (conditions.stopIfHandoff === true) {
      check(
        'stopIfHandoff',
        'Sem atendimento humano em curso',
        !context.handoffActive,
        context.handoffActive
          ? 'Há handoff ativo: a automação seria cancelada.'
          : 'Nenhum handoff ativo.',
        LeadFlowAutomationSkipReason.HandoffInProgress,
      );
    }

    // --- qualification -----------------------------------------------------
    if (minScore !== null) {
      check(
        'minScore',
        'Pontuação mínima atingida',
        context.leadScore >= minScore,
        `Pontuação ${context.leadScore} contra o mínimo de ${minScore}.`,
        LeadFlowAutomationSkipReason.ScoreBelowThreshold,
      );
    }

    const keywords = this.stringList(conditions.keywords);
    if (keywords.length > 0) {
      const matched = context.matchedKeywords.filter((item) =>
        keywords.includes(item),
      );
      check(
        'keywords',
        'Palavra-chave encontrada',
        matched.length > 0,
        matched.length > 0
          ? `Encontradas: ${matched.join(', ')}.`
          : 'Nenhuma das palavras-chave configuradas apareceu.',
        LeadFlowAutomationSkipReason.ConditionNotMet,
      );
    }

    const intents = this.stringList(conditions.intents);
    if (intents.length > 0) {
      const matched = context.matchedIntents.filter((item) =>
        intents.includes(item),
      );
      check(
        'intents',
        'Intenção reconhecida',
        matched.length > 0,
        matched.length > 0
          ? `Reconhecidas: ${matched.join(', ')}.`
          : 'Nenhuma das intenções configuradas foi reconhecida.',
        LeadFlowAutomationSkipReason.ConditionNotMet,
      );
    }

    // Data-quality recipes act when something is MISSING, so the check passes
    // when at least one required field is absent.
    const requiredFields = this.stringList(conditions.requiredFields);
    if (requiredFields.length > 0) {
      const missing = requiredFields.filter(
        (field) => !context.presentFields.includes(field),
      );
      check(
        'requiredFields',
        'Há campos pendentes a cobrar',
        missing.length > 0,
        missing.length > 0
          ? `Pendentes: ${missing.join(', ')}.`
          : 'Todos os campos obrigatórios já estão preenchidos.',
        LeadFlowAutomationSkipReason.ConditionNotMet,
      );
    }

    // --- rate limits -------------------------------------------------------
    const maxAttempts =
      typeof actions.maxAttempts === 'number' ? actions.maxAttempts : null;
    if (maxAttempts !== null) {
      check(
        'maxAttempts',
        'Dentro do limite de tentativas',
        context.attemptsSoFar < maxAttempts,
        `${context.attemptsSoFar} de ${maxAttempts} tentativas usadas.`,
        LeadFlowAutomationSkipReason.AttemptLimitReached,
      );
    }

    const cooldownHours =
      typeof schedule.cooldownHours === 'number'
        ? schedule.cooldownHours
        : null;
    if (cooldownHours !== null && cooldownHours > 0) {
      check(
        'cooldown',
        'Intervalo mínimo respeitado',
        context.hoursSinceLastRun >= cooldownHours,
        `${context.hoursSinceLastRun}h desde a última execução, mínimo de ${cooldownHours}h.`,
        LeadFlowAutomationSkipReason.CooldownActive,
      );
    }

    const wouldAct = checks.every((item) => item.passed);

    return {
      wouldAct,
      status: wouldAct
        ? LeadFlowAutomationRunStatus.Succeeded
        : LeadFlowAutomationRunStatus.Skipped,
      skipReason: wouldAct ? null : skipReason,
      checks,
      plannedActions: wouldAct ? this.plannedActions(automation, recipe) : [],
      context,
    };
  }

  /** Actions the automation would request, in order. */
  private plannedActions(
    automation: LeadFlowAutomationEntity,
    recipe: LeadFlowAutomationRecipeCatalogItem,
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
    context: LeadFlowAutomationEvaluation['context'],
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
    };
  }

  private stringList(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }
}
