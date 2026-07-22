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
        if (this.isEmpty(values[spec.key])) {
          missing.push(`${section}.${spec.key}`);
        }
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

      default:
        return [];
    }
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
}
