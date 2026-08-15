import { Injectable } from '@nestjs/common';
import {
  buildConfigSchema,
  getSectionSchema,
  LEADFLOW_AUTOMATION_CONFIG_SECTIONS,
  type LeadFlowAutomationConfigAudience,
  type LeadFlowAutomationConfigSchema,
  type LeadFlowAutomationConfigSection,
  type LeadFlowAutomationFieldSpec,
} from '../catalog/automation-config-schemas.catalog';
import {
  AUTOMATIC_TAGGING_RECIPE_KEY,
  DAILY_OPPORTUNITY_SUMMARY_RECIPE_KEY,
  FOLLOWUP_IDLE_LEAD_RECIPE_KEY,
  LEADFLOW_TAG_RULE_OPERATORS,
  NOTIFICATION_CHANNEL_RECIPE_KEYS,
  OUTSIDE_BUSINESS_HOURS_RECIPE_KEY,
  type LeadFlowAutomationRecipeCatalogItem,
} from '../catalog/automation-recipes.catalog';
import { enabledFollowupSteps } from '../catalog/followup-plan.catalog';
import {
  BUSINESS_HOURS_WEEKDAYS,
  isBusinessHoursTime,
} from './business-hours-schedule';

export interface LeadFlowAutomationConfigError {
  /** `section.key`, or just `section` for a malformed section. */
  path: string;
  code:
    | 'unknown_field'
    | 'read_only_field'
    | 'invalid_type'
    | 'out_of_range'
    | 'too_long'
    | 'too_many_items'
    | 'not_nullable'
    | 'malformed_section';
  message: string;
}

export interface LeadFlowAutomationConfigValidation {
  valid: boolean;
  errors: LeadFlowAutomationConfigError[];
}

type Section = LeadFlowAutomationConfigSection;

/**
 * Fail-closed validator for automation configuration.
 *
 * The jsonb config columns used to accept any shape, which made them an
 * arbitrary write surface and let the UI persist keys no runtime would ever
 * read. Validation is closed by default: only keys declared by the recipe's
 * schema are accepted, and structural fields (the trigger and the primary
 * action) are read-only because they define what the recipe *is*.
 */
@Injectable()
export class LeadFlowAutomationConfigSchemaService {
  buildSchema(
    recipe: LeadFlowAutomationRecipeCatalogItem,
    audience: LeadFlowAutomationConfigAudience = 'agency',
  ): LeadFlowAutomationConfigSchema {
    return buildConfigSchema(recipe, audience);
  }

  /**
   * Validates one section against the recipe schema.
   * `defaults` supplies the authoritative value for read-only fields.
   *
   * The audience narrows the schema before validation, so a field the caller's
   * context is not allowed to see is refused as `unknown_field` — the same
   * answer an invented key gets, and for the same reason.
   */
  validateSection(
    recipe: LeadFlowAutomationRecipeCatalogItem,
    section: Section,
    value: unknown,
    defaults: Record<string, unknown>,
    audience: LeadFlowAutomationConfigAudience = 'agency',
  ): LeadFlowAutomationConfigValidation {
    const errors: LeadFlowAutomationConfigError[] = [];

    if (!this.isPlainObject(value)) {
      return {
        valid: false,
        errors: [
          {
            path: section,
            code: 'malformed_section',
            message: 'A configuração precisa ser um objeto.',
          },
        ],
      };
    }

    const specs = getSectionSchema(recipe, section, audience);
    const specByKey = new Map(specs.map((spec) => [spec.key, spec]));

    for (const [key, raw] of Object.entries(value)) {
      const spec = specByKey.get(key);
      if (!spec) {
        errors.push({
          path: `${section}.${key}`,
          code: 'unknown_field',
          message: `Campo "${key}" não faz parte desta automação.`,
        });
        continue;
      }

      if (spec.readOnly) {
        const expected = defaults[key];
        if (raw !== expected) {
          errors.push({
            path: `${section}.${key}`,
            code: 'read_only_field',
            message: `"${spec.label}" é definido pela receita e não pode ser alterado.`,
          });
        }
        continue;
      }

      errors.push(...this.validateValue(section, spec, raw));
    }

    return { valid: errors.length === 0, errors };
  }

  /** Required fields that are absent, null or empty — drives readiness. */
  findMissingRequiredFields(
    recipe: LeadFlowAutomationRecipeCatalogItem,
    config: Partial<Record<Section, Record<string, unknown>>>,
    audience: LeadFlowAutomationConfigAudience = 'agency',
  ): string[] {
    const missing: string[] = [];

    for (const section of LEADFLOW_AUTOMATION_CONFIG_SECTIONS) {
      const specs = getSectionSchema(recipe, section, audience);
      const values = config[section] ?? {};

      for (const spec of specs) {
        if (!spec.required) continue;
        // Existing Fase 6 rows predate the per-step contract. Preserve their
        // implicit WhatsApp policy until an operator saves the new surface.
        if (
          section === 'message' &&
          spec.key === 'followupSteps' &&
          recipe.key === FOLLOWUP_IDLE_LEAD_RECIPE_KEY &&
          values.followupSteps === undefined &&
          typeof values.baseMessage === 'string' &&
          values.baseMessage.trim()
        ) {
          continue;
        }
        if (this.isEmpty(values[spec.key])) {
          missing.push(`${section}.${spec.key}`);
        }
      }
    }

    // The canonical cadence answers "does this attempt happen" with `enabled`,
    // because d0 and d1 reply inside the conversation and have no channel of
    // their own to switch on. A plan with every attempt off is a follow-up that
    // never sends anything, so it counts as unconfigured.
    if (
      recipe.key === FOLLOWUP_IDLE_LEAD_RECIPE_KEY &&
      Array.isArray(config.message?.followupSteps) &&
      enabledFollowupSteps(config.message.followupSteps).length === 0 &&
      !missing.includes('message.followupSteps')
    ) {
      missing.push('message.followupSteps');
    }

    if (NOTIFICATION_CHANNEL_RECIPE_KEYS.includes(recipe.key)) {
      const channels = Array.isArray(config.actions?.notificationChannels)
        ? config.actions.notificationChannels
        : [];
      const eligible = channels.some((channel) =>
        ['in_app', 'push', 'platform_whatsapp', 'email'].includes(
          String(channel),
        ),
      );
      if (!eligible && !missing.includes('actions.notificationChannels')) {
        // Provider availability is evaluated dynamically by the lifecycle.
        // SMS remains unimplemented and cannot make a configuration ready.
        missing.push('actions.notificationChannels');
      }
    }

    // A rule nobody finished is a rule that never applies a tag. Counting it as
    // configured would leave the automation running and doing nothing for the
    // decision the operator thought they had made.
    if (
      recipe.key === AUTOMATIC_TAGGING_RECIPE_KEY &&
      Array.isArray(config.conditions?.tagRules) &&
      config.conditions.tagRules.some(
        (rule) => !this.isCompleteTagRule(rule),
      ) &&
      !missing.includes('conditions.tagRules')
    ) {
      missing.push('conditions.tagRules');
    }

    // The out-of-hours reply *is* its message. `message.baseMessage` is not
    // required in general — most recipes only use it as guidance for the agent
    // — but here the executor sends this text verbatim, so an empty one is an
    // automation that would run and refuse at the last step.
    if (
      recipe.key === OUTSIDE_BUSINESS_HOURS_RECIPE_KEY &&
      this.isEmpty(config.message?.baseMessage) &&
      !missing.includes('message.baseMessage')
    ) {
      missing.push('message.baseMessage');
    }

    // Cadence asks for a weekday or a day of the month only inside the answer
    // that needs one. Neither field can be `required` in the dictionary: a daily
    // summary with both empty is completely configured.
    if (recipe.key === DAILY_OPPORTUNITY_SUMMARY_RECIPE_KEY) {
      const schedule = config.schedulePolicy ?? {};
      if (
        schedule.frequency === 'weekly' &&
        this.isEmpty(schedule.weekday) &&
        !missing.includes('schedulePolicy.weekday')
      ) {
        missing.push('schedulePolicy.weekday');
      }
      if (
        schedule.frequency === 'monthly' &&
        this.isEmpty(schedule.dayOfMonth) &&
        !missing.includes('schedulePolicy.dayOfMonth')
      ) {
        missing.push('schedulePolicy.dayOfMonth');
      }

      // Turning the Team Chat delivery on without picking a channel is a
      // destination that does not exist. The pair only reaches readiness
      // together, and only where the agency is the audience.
      const actions = config.actions ?? {};
      if (
        audience === 'agency' &&
        actions.deliverToTeamChat === true &&
        this.isEmpty(actions.teamChatChannelId) &&
        !missing.includes('actions.teamChatChannelId')
      ) {
        missing.push('actions.teamChatChannelId');
      }
    }

    return missing;
  }

  private validateValue(
    section: Section,
    spec: LeadFlowAutomationFieldSpec,
    raw: unknown,
  ): LeadFlowAutomationConfigError[] {
    const path = `${section}.${spec.key}`;

    if (raw === null && spec.inheritable) {
      return [];
    }

    if (raw === null || raw === undefined) {
      if (spec.nullable || raw === undefined) {
        return [];
      }
      return [
        {
          path,
          code: 'not_nullable',
          message: `"${spec.label}" não pode ficar vazio.`,
        },
      ];
    }

    switch (spec.type) {
      case 'boolean':
        return typeof raw === 'boolean'
          ? []
          : [this.typeError(path, spec, 'um valor sim/não')];

      case 'number': {
        if (typeof raw !== 'number' || !Number.isFinite(raw)) {
          return [this.typeError(path, spec, 'um número')];
        }
        if (spec.key === 'dayOfMonth' && !Number.isInteger(raw)) {
          return [this.typeError(path, spec, 'um dia inteiro do mês')];
        }
        if (
          (spec.min !== undefined && raw < spec.min) ||
          (spec.max !== undefined && raw > spec.max)
        ) {
          return [
            {
              path,
              code: 'out_of_range',
              message: `"${spec.label}" deve ficar entre ${spec.min ?? '-∞'} e ${spec.max ?? '∞'}.`,
            },
          ];
        }
        return [];
      }

      case 'string':
      case 'enum': {
        if (typeof raw !== 'string') {
          return [this.typeError(path, spec, 'um texto')];
        }
        if (spec.values && !spec.values.includes(raw)) {
          return [
            {
              path,
              code: 'invalid_type',
              message: `"${spec.label}" tem um valor não permitido.`,
            },
          ];
        }
        if (spec.maxLength !== undefined && raw.length > spec.maxLength) {
          return [
            {
              path,
              code: 'too_long',
              message: `"${spec.label}" excede ${spec.maxLength} caracteres.`,
            },
          ];
        }
        if (
          spec.key === 'dailyTime' &&
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)
        ) {
          return [
            {
              path,
              code: 'invalid_type',
              message: `"${spec.label}" deve usar o formato HH:mm.`,
            },
          ];
        }
        if (spec.key === 'timezone') {
          try {
            new Intl.DateTimeFormat('pt-BR', { timeZone: raw }).format();
          } catch {
            return [
              {
                path,
                code: 'invalid_type',
                message: `"${spec.label}" precisa ser um fuso IANA válido.`,
              },
            ];
          }
        }
        return [];
      }

      case 'string[]': {
        if (!Array.isArray(raw)) {
          return [this.typeError(path, spec, 'uma lista')];
        }
        if (spec.maxItems !== undefined && raw.length > spec.maxItems) {
          return [
            {
              path,
              code: 'too_many_items',
              message: `"${spec.label}" aceita no máximo ${spec.maxItems} itens.`,
            },
          ];
        }
        for (const item of raw) {
          if (typeof item !== 'string') {
            return [this.typeError(path, spec, 'uma lista de textos')];
          }
          if (spec.values && !spec.values.includes(item)) {
            return [
              {
                path,
                code: 'invalid_type',
                message: `"${spec.label}" contém um valor não permitido.`,
              },
            ];
          }
          if (spec.maxLength !== undefined && item.length > spec.maxLength) {
            return [
              {
                path,
                code: 'too_long',
                message: `Cada item de "${spec.label}" excede ${spec.maxLength} caracteres.`,
              },
            ];
          }
        }
        return [];
      }

      case 'offset[]': {
        if (!Array.isArray(raw)) {
          return [this.typeError(path, spec, 'uma lista de antecedências')];
        }
        if (spec.maxItems !== undefined && raw.length > spec.maxItems) {
          return [
            {
              path,
              code: 'too_many_items',
              message: `"${spec.label}" aceita no máximo ${spec.maxItems} itens.`,
            },
          ];
        }
        for (const item of raw) {
          if (
            !this.isPlainObject(item) ||
            typeof item.label !== 'string' ||
            typeof item.minutesBefore !== 'number' ||
            !Number.isFinite(item.minutesBefore) ||
            item.minutesBefore < 0
          ) {
            return [
              {
                path,
                code: 'invalid_type',
                message: `Cada item de "${spec.label}" precisa ter um rótulo e uma antecedência em minutos.`,
              },
            ];
          }
        }
        return [];
      }

      case 'followup_step[]':
        return this.validateFollowupSteps(path, spec, raw);

      case 'tag_rule[]':
        return this.validateTagRules(path, spec, raw);

      case 'business_hours':
        return this.validateBusinessHours(path, spec, raw);

      default:
        return [];
    }
  }

  /**
   * Shape of a weekly schedule: the days of the week, each either closed or
   * carrying an `HH:MM` window, in a real time zone.
   *
   * A day that is open with no hours is rejected rather than ignored — it is
   * the one mistake that silently changes when the business is considered
   * closed, and the operator would have no way of seeing it on the screen.
   */
  private validateBusinessHours(
    path: string,
    spec: LeadFlowAutomationFieldSpec,
    raw: unknown,
  ): LeadFlowAutomationConfigError[] {
    if (!this.isPlainObject(raw)) {
      return [this.typeError(path, spec, 'um horário semanal')];
    }
    if (
      !this.hasOnlyKeys(raw, ['enabled', 'timezone', 'days']) ||
      (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') ||
      typeof raw.timezone !== 'string' ||
      !Array.isArray(raw.days)
    ) {
      return [this.typeError(path, spec, 'um horário semanal')];
    }
    try {
      new Intl.DateTimeFormat('pt-BR', { timeZone: raw.timezone }).format();
    } catch {
      return [
        {
          path,
          code: 'invalid_type',
          message: `"${spec.label}" precisa usar um fuso IANA válido.`,
        },
      ];
    }
    if (raw.days.length > BUSINESS_HOURS_WEEKDAYS.length) {
      return [
        {
          path,
          code: 'too_many_items',
          message: `"${spec.label}" tem no máximo um período por dia da semana.`,
        },
      ];
    }

    const seen = new Set<string>();
    for (const entry of raw.days) {
      if (
        !this.isPlainObject(entry) ||
        !this.hasOnlyKeys(entry, ['day', 'enabled', 'start', 'end']) ||
        typeof entry.day !== 'string' ||
        !BUSINESS_HOURS_WEEKDAYS.includes(entry.day as never) ||
        typeof entry.enabled !== 'boolean' ||
        typeof entry.start !== 'string' ||
        typeof entry.end !== 'string' ||
        (entry.enabled &&
          (!isBusinessHoursTime(entry.start) ||
            !isBusinessHoursTime(entry.end)))
      ) {
        return [
          {
            path,
            code: 'invalid_type',
            message: `Cada dia de "${spec.label}" precisa dizer se atende e, se atende, das quantas às quantas.`,
          },
        ];
      }
      if (seen.has(entry.day)) {
        return [
          {
            path,
            code: 'invalid_type',
            message: `"${spec.label}" repete um dia da semana.`,
          },
        ];
      }
      seen.add(entry.day);
    }

    return [];
  }

  /**
   * Shape of the tagging rules. Only structure is enforced here: a rule that is
   * well-formed but not yet decided — no field, no tags, or a comparison with
   * nothing to compare against — is an *incomplete* configuration, reported by
   * `findMissingRequiredFields` so the operator sees it on the automation
   * instead of losing a half-written rule to a rejected save.
   */
  private validateTagRules(
    path: string,
    spec: LeadFlowAutomationFieldSpec,
    raw: unknown,
  ): LeadFlowAutomationConfigError[] {
    if (!Array.isArray(raw)) {
      return [this.typeError(path, spec, 'uma lista de regras')];
    }
    if (spec.maxItems !== undefined && raw.length > spec.maxItems) {
      return [
        {
          path,
          code: 'too_many_items',
          message: `"${spec.label}" aceita no máximo ${spec.maxItems} regras.`,
        },
      ];
    }

    for (const rule of raw) {
      if (
        !this.isPlainObject(rule) ||
        !this.hasOnlyKeys(rule, ['field', 'operator', 'value', 'tagIds']) ||
        typeof rule.field !== 'string' ||
        rule.field.length > 80 ||
        typeof rule.operator !== 'string' ||
        !LEADFLOW_TAG_RULE_OPERATORS.includes(
          rule.operator as (typeof LEADFLOW_TAG_RULE_OPERATORS)[number],
        ) ||
        (rule.value !== undefined &&
          rule.value !== null &&
          (typeof rule.value !== 'string' || rule.value.length > 180)) ||
        !Array.isArray(rule.tagIds)
      ) {
        return [
          {
            path,
            code: 'invalid_type',
            message:
              'Cada regra precisa ter um campo, um operador conhecido e a lista de tags.',
          },
        ];
      }

      if (rule.tagIds.length > 20) {
        return [
          {
            path,
            code: 'too_many_items',
            message: 'Uma regra aceita no máximo 20 tags.',
          },
        ];
      }

      for (const tagId of rule.tagIds) {
        if (typeof tagId !== 'string' || !tagId.trim() || tagId.length > 64) {
          return [
            {
              path,
              code: 'invalid_type',
              message: 'As tags de uma regra precisam ser referências do CRM.',
            },
          ];
        }
      }
    }

    return [];
  }

  private validateFollowupSteps(
    path: string,
    spec: LeadFlowAutomationFieldSpec,
    raw: unknown,
  ): LeadFlowAutomationConfigError[] {
    if (!Array.isArray(raw)) {
      return [this.typeError(path, spec, 'uma lista de passos')];
    }
    if (spec.maxItems !== undefined && raw.length > spec.maxItems) {
      return [
        {
          path,
          code: 'too_many_items',
          message: `"${spec.label}" aceita no máximo ${spec.maxItems} itens.`,
        },
      ];
    }

    const stepKeys = new Set<string>();
    const allowedChannels = new Set([
      'whatsapp',
      'email',
      'sms',
      'facebook_messenger',
      'instagram_direct',
      'webchat',
    ]);
    const insideWindowOnly = new Set([
      'facebook_messenger',
      'instagram_direct',
      'webchat',
    ]);

    for (const step of raw) {
      if (
        !this.isPlainObject(step) ||
        // `enabled` is what lets an attempt with no channel of its own — d0 and
        // d1 answer inside the conversation — still say that it happens.
        !this.hasOnlyKeys(step, [
          'stepKey',
          'enabled',
          'delayMinutes',
          'channels',
        ]) ||
        typeof step.stepKey !== 'string' ||
        !step.stepKey.trim() ||
        step.stepKey.length > 80 ||
        (step.enabled !== undefined && typeof step.enabled !== 'boolean') ||
        typeof step.delayMinutes !== 'number' ||
        !Number.isFinite(step.delayMinutes) ||
        step.delayMinutes < 0 ||
        !Array.isArray(step.channels)
      ) {
        return [
          {
            path,
            code: 'invalid_type',
            message:
              'Cada passo precisa ter chave, atraso em minutos e uma lista de canais.',
          },
        ];
      }
      if (stepKeys.has(step.stepKey)) {
        return [
          {
            path,
            code: 'invalid_type',
            message: 'As chaves dos passos do follow-up não podem se repetir.',
          },
        ];
      }
      stepKeys.add(step.stepKey);

      const channels = new Set<string>();
      for (const channelConfig of step.channels) {
        if (
          !this.isPlainObject(channelConfig) ||
          !this.hasOnlyKeys(channelConfig, [
            'channel',
            'enabled',
            'outsideWindowEnabled',
            'connectionRef',
            'whatsappTemplate',
          ]) ||
          typeof channelConfig.channel !== 'string' ||
          !allowedChannels.has(channelConfig.channel) ||
          typeof channelConfig.enabled !== 'boolean' ||
          typeof channelConfig.outsideWindowEnabled !== 'boolean'
        ) {
          return [
            {
              path,
              code: 'invalid_type',
              message: 'A política de um canal do follow-up é inválida.',
            },
          ];
        }
        if (channels.has(channelConfig.channel)) {
          return [
            {
              path,
              code: 'invalid_type',
              message: 'Um canal não pode se repetir no mesmo passo.',
            },
          ];
        }
        channels.add(channelConfig.channel);
        if (
          insideWindowOnly.has(channelConfig.channel) &&
          channelConfig.outsideWindowEnabled
        ) {
          return [
            {
              path,
              code: 'invalid_type',
              message:
                'Messenger, Instagram Direct e Webchat não aceitam follow-up fora da janela nesta fase.',
            },
          ];
        }
        if (
          channelConfig.connectionRef !== undefined &&
          channelConfig.connectionRef !== null &&
          (typeof channelConfig.connectionRef !== 'string' ||
            !channelConfig.connectionRef.trim() ||
            channelConfig.connectionRef.length > 64)
        ) {
          return [
            {
              path,
              code: 'invalid_type',
              message: 'A referência da conexão do canal é inválida.',
            },
          ];
        }
        if (channelConfig.whatsappTemplate !== undefined) {
          const template = channelConfig.whatsappTemplate;
          if (
            channelConfig.channel !== 'whatsapp' ||
            !this.isPlainObject(template) ||
            !this.hasOnlyKeys(template, [
              'providerTemplateName',
              'languageCode',
              'status',
            ]) ||
            typeof template.providerTemplateName !== 'string' ||
            template.providerTemplateName.length > 512 ||
            typeof template.languageCode !== 'string' ||
            !template.languageCode.trim() ||
            template.languageCode.length > 35 ||
            (template.status !== undefined &&
              (typeof template.status !== 'string' ||
                ![
                  'not_configured',
                  'pending_validation',
                  'valid',
                  'not_found',
                  'not_approved',
                  'language_mismatch',
                  'components_unsupported',
                ].includes(template.status)))
          ) {
            return [
              {
                path,
                code: 'invalid_type',
                message: 'A referência do template WhatsApp é inválida.',
              },
            ];
          }
        }
      }
    }
    return [];
  }

  /**
   * A rule the runtime can actually evaluate: something to look at, something
   * to compare against unless the comparison is "is it filled in", and at least
   * one tag to apply.
   */
  private isCompleteTagRule(rule: unknown): boolean {
    if (!this.isPlainObject(rule)) return false;
    if (typeof rule.field !== 'string' || !rule.field.trim()) return false;
    if (!Array.isArray(rule.tagIds) || rule.tagIds.length === 0) return false;
    if (rule.operator === 'is_present') return true;
    return typeof rule.value === 'string' && rule.value.trim().length > 0;
  }

  private typeError(
    path: string,
    spec: LeadFlowAutomationFieldSpec,
    expected: string,
  ): LeadFlowAutomationConfigError {
    return {
      path,
      code: 'invalid_type',
      message: `"${spec.label}" precisa ser ${expected}.`,
    };
  }

  private isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    return false;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private hasOnlyKeys(
    value: Record<string, unknown>,
    allowed: string[],
  ): boolean {
    return Object.keys(value).every((key) => allowed.includes(key));
  }
}
