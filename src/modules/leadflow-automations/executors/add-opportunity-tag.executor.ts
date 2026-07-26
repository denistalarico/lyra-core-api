import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { CrmService } from '../../crm/crm.service';
import { CrmOpportunityFieldCatalogService } from '../../crm/services/crm-opportunity-field-catalog.service';
import { LeadFlowAutomationErrorClass } from '../enums/leadflow-automation-run.enums';
import { executorAvailability } from './automation-executors.registry';
import type {
  AutomationEffectRequest,
  AutomationEffectResult,
  AutomationExecutor,
  AutomationExecutorAvailability,
} from './automation-executor.types';

type TagRuleOperator = 'equals' | 'not_equals' | 'contains' | 'is_present';

/**
 * Applies existing CRM tags to an opportunity through the canonical CRM
 * service. The rule is re-evaluated against the current opportunity immediately
 * before any write, every tag is prevalidated in the same tenant/workspace, and
 * the CRM association itself is idempotent.
 */
@Injectable()
export class AddOpportunityTagExecutor implements AutomationExecutor {
  readonly actionKey = 'add_tag';

  constructor(
    private readonly crm: CrmService,
    private readonly fields: CrmOpportunityFieldCatalogService,
  ) {}

  availability(): AutomationExecutorAvailability {
    return executorAvailability(this.actionKey);
  }

  async execute(
    request: AutomationEffectRequest,
  ): Promise<AutomationEffectResult> {
    const opportunityId = stringField(request.payload.opportunityId);
    const tagIds = stringList(request.payload.tagIds);
    const ruleField = stringField(request.payload.ruleField);
    const ruleOperator = operatorField(request.payload.ruleOperator);
    const ruleValue = stringField(request.payload.ruleValue);

    if (!opportunityId || tagIds.length === 0 || !ruleField || !ruleOperator) {
      return refusal(
        'tag_rule_unconfigured',
        'A tag automática exige oportunidade, regra e pelo menos uma tag do CRM.',
      );
    }

    if (
      !this.fields.isAddressable(ruleField) ||
      ruleField.startsWith('leadScore.')
    ) {
      return refusal(
        'tag_rule_field_invalid',
        'O campo configurado não pode ser usado por esta regra de tag.',
      );
    }

    const ctx = {
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
    } as RequestContext;

    try {
      const opportunity = await this.crm.getOpportunity(ctx, opportunityId);
      const currentValue = readOpportunityField(
        opportunity as unknown as Record<string, unknown>,
        ruleField,
      );
      if (!matchesRule(currentValue, ruleOperator, ruleValue)) {
        return refusal(
          'tag_rule_not_matched',
          'A oportunidade não atende mais à regra configurada para esta tag.',
        );
      }

      // Validate the whole batch before assigning the first tag. A stale or
      // cross-workspace tag therefore cannot leave a partially applied rule.
      await Promise.all(tagIds.map((tagId) => this.crm.getTag(ctx, tagId)));

      for (const tagId of tagIds) {
        await this.crm.assignOpportunityTag(ctx, opportunityId, {
          tagId,
          assignedByType: 'automation',
          metadata: {
            automationId: request.automationId,
            correlationId: request.correlationId,
          },
        });
      }

      return {
        status: 'confirmed',
        effectConfirmed: true,
        reference: opportunityId,
        details: {
          appliedTagIds: tagIds,
          ruleField,
          ruleOperator,
        },
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        return refusal(
          'tag_assignment_refused',
          'A oportunidade ou uma das tags configuradas não está disponível neste workspace.',
        );
      }
      return {
        status: 'failed',
        effectConfirmed: false,
        errorClass: LeadFlowAutomationErrorClass.Transient,
        errorCode: 'tag_assignment_failed',
        errorMessage: 'A aplicação da tag falhou por um erro transitório.',
        reference: null,
      };
    }
  }
}

function refusal(code: string, message: string): AutomationEffectResult {
  return {
    status: 'refused',
    effectConfirmed: false,
    errorClass: LeadFlowAutomationErrorClass.Permanent,
    errorCode: code,
    errorMessage: message,
    reference: null,
  };
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((item): item is string => Boolean(stringField(item))),
        ),
      ]
    : [];
}

function operatorField(value: unknown): TagRuleOperator | null {
  return ['equals', 'not_equals', 'contains', 'is_present'].includes(
    String(value),
  )
    ? (value as TagRuleOperator)
    : null;
}

function readOpportunityField(
  opportunity: Record<string, unknown>,
  field: string,
): unknown {
  if (field.startsWith('businessContext.')) {
    const context = opportunity.businessContext;
    return context && typeof context === 'object' && !Array.isArray(context)
      ? (context as Record<string, unknown>)[
          field.slice('businessContext.'.length)
        ]
      : undefined;
  }
  return opportunity[field];
}

function matchesRule(
  current: unknown,
  operator: TagRuleOperator,
  expected: string | null,
): boolean {
  const present =
    current !== null &&
    current !== undefined &&
    (typeof current !== 'string' || current.trim() !== '') &&
    (!Array.isArray(current) || current.length > 0);
  if (operator === 'is_present') return present;

  const actual = normalizeComparableValue(current);
  const normalizedExpected = (expected ?? '').trim().toLocaleLowerCase('pt-BR');
  if (!normalizedExpected) return false;
  if (operator === 'equals') return actual === normalizedExpected;
  if (operator === 'not_equals') return actual !== normalizedExpected;
  return actual.includes(normalizedExpected);
}

function normalizeComparableValue(value: unknown): string {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value).trim().toLocaleLowerCase('pt-BR');
  }
  if (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean',
    )
  ) {
    return value.join(',').trim().toLocaleLowerCase('pt-BR');
  }
  return '';
}
