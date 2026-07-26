import { Injectable } from '@nestjs/common';
import {
  buildConfigSchema,
  getSectionSchema,
  LEADFLOW_AUTOMATION_CONFIG_SECTIONS,
  type LeadFlowAutomationConfigSchema,
  type LeadFlowAutomationConfigSection,
  type LeadFlowAutomationFieldSpec,
} from '../catalog/automation-config-schemas.catalog';
import type { LeadFlowAutomationRecipeCatalogItem } from '../catalog/automation-recipes.catalog';

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
  ): LeadFlowAutomationConfigSchema {
    return buildConfigSchema(recipe);
  }

  /**
   * Validates one section against the recipe schema.
   * `defaults` supplies the authoritative value for read-only fields.
   */
  validateSection(
    recipe: LeadFlowAutomationRecipeCatalogItem,
    section: Section,
    value: unknown,
    defaults: Record<string, unknown>,
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

    const specs = getSectionSchema(recipe, section);
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
  ): string[] {
    const missing: string[] = [];

    for (const section of LEADFLOW_AUTOMATION_CONFIG_SECTIONS) {
      const specs = getSectionSchema(recipe, section);
      const values = config[section] ?? {};

      for (const spec of specs) {
        if (!spec.required) continue;
        // Existing Fase 6 rows predate the per-step contract. Preserve their
        // implicit WhatsApp policy until an operator saves the new surface.
        if (
          section === 'message' &&
          spec.key === 'followupSteps' &&
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

    if (
      ['followup_idle_lead', 'followup_by_crm_stage'].includes(recipe.key) &&
      Array.isArray(config.message?.followupSteps) &&
      !config.message.followupSteps.some(
        (step) =>
          this.isPlainObject(step) &&
          Array.isArray(step.channels) &&
          step.channels.some(
            (channel) =>
              this.isPlainObject(channel) && channel.enabled === true,
          ),
      ) &&
      !missing.includes('message.followupSteps')
    ) {
      missing.push('message.followupSteps');
    }

    return missing;
  }

  private validateValue(
    section: Section,
    spec: LeadFlowAutomationFieldSpec,
    raw: unknown,
  ): LeadFlowAutomationConfigError[] {
    const path = `${section}.${spec.key}`;

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

      default:
        return [];
    }
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
        !this.hasOnlyKeys(step, ['stepKey', 'delayMinutes', 'channels']) ||
        typeof step.stepKey !== 'string' ||
        !step.stepKey.trim() ||
        step.stepKey.length > 80 ||
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
