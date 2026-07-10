import { Injectable } from '@nestjs/common';
import { getEventByName } from '../catalog/leadflow-event.catalog';
import type {
  LeadFlowEventValidationError,
  LeadFlowEventValidationResponse,
} from '../dto/leadflow-event-response.dto';
import {
  LEADFLOW_EVENT_ACTOR_TYPES,
  LEADFLOW_EVENT_MODULE_KEYS,
  LEADFLOW_EVENT_PRODUCT_KEY,
} from '../types/leadflow-event.types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value)
  );
}

/**
 * Validates a LeadFlow event envelope against the contract and the catalog
 * (blueprint sections 6, 7 and 11). Pure function behind an endpoint: it
 * NEVER persists the event, emits it, or triggers anything.
 */
@Injectable()
export class LeadFlowEventValidationService {
  validate(input: Record<string, unknown>): LeadFlowEventValidationResponse {
    const errors: LeadFlowEventValidationError[] = [];

    const missing = (field: string) =>
      errors.push({
        code: 'missing_field',
        field,
        message: `Campo obrigatório ausente: ${field}.`,
      });
    const invalid = (field: string, message: string) =>
      errors.push({ code: 'invalid_field', field, message });

    // eventId
    if (input.eventId === undefined || input.eventId === null) {
      missing('eventId');
    } else if (
      !isNonEmptyString(input.eventId) ||
      !UUID_PATTERN.test(input.eventId)
    ) {
      invalid('eventId', 'eventId deve ser um uuid.');
    }

    // eventName + catalog lookup
    const eventName = isNonEmptyString(input.eventName)
      ? input.eventName
      : null;
    if (input.eventName === undefined || input.eventName === null) {
      missing('eventName');
    } else if (!eventName) {
      invalid('eventName', 'eventName deve ser uma string não vazia.');
    }

    const catalogItem = eventName ? getEventByName(eventName) : undefined;
    if (eventName && !catalogItem) {
      errors.push({
        code: 'unknown_event',
        field: 'eventName',
        message: `Evento desconhecido no catálogo LeadFlow: ${eventName}.`,
      });
    }

    // eventVersion
    if (input.eventVersion === undefined || input.eventVersion === null) {
      missing('eventVersion');
    } else if (
      typeof input.eventVersion !== 'number' ||
      !Number.isInteger(input.eventVersion) ||
      input.eventVersion < 1
    ) {
      invalid('eventVersion', 'eventVersion deve ser um inteiro >= 1.');
    } else if (catalogItem && input.eventVersion !== catalogItem.eventVersion) {
      errors.push({
        code: 'unsupported_version',
        field: 'eventVersion',
        message: `Versão ${input.eventVersion} não suportada para ${catalogItem.eventName} (contrato atual: ${catalogItem.eventVersion}).`,
      });
    }

    // occurredAt
    if (input.occurredAt === undefined || input.occurredAt === null) {
      missing('occurredAt');
    } else if (
      !isNonEmptyString(input.occurredAt) ||
      Number.isNaN(Date.parse(input.occurredAt))
    ) {
      invalid('occurredAt', 'occurredAt deve ser uma data ISO 8601 válida.');
    }

    // tenant / workspace (multi-tenant obrigatório)
    for (const field of ['tenantId', 'workspaceId'] as const) {
      if (input[field] === undefined || input[field] === null) {
        missing(field);
      } else if (!isNonEmptyString(input[field])) {
        invalid(field, `${field} deve ser uma string não vazia.`);
      }
    }

    // productKey
    if (input.productKey === undefined || input.productKey === null) {
      missing('productKey');
    } else if (input.productKey !== LEADFLOW_EVENT_PRODUCT_KEY) {
      errors.push({
        code: 'invalid_product_key',
        field: 'productKey',
        message: `productKey deve ser '${LEADFLOW_EVENT_PRODUCT_KEY}'.`,
      });
    }

    // moduleKey
    if (input.moduleKey === undefined || input.moduleKey === null) {
      missing('moduleKey');
    } else if (
      !isNonEmptyString(input.moduleKey) ||
      !LEADFLOW_EVENT_MODULE_KEYS.includes(
        input.moduleKey as (typeof LEADFLOW_EVENT_MODULE_KEYS)[number],
      )
    ) {
      invalid(
        'moduleKey',
        `moduleKey deve ser um de: ${LEADFLOW_EVENT_MODULE_KEYS.join(', ')}.`,
      );
    } else if (catalogItem && input.moduleKey !== catalogItem.moduleKey) {
      errors.push({
        code: 'incompatible_module_key',
        field: 'moduleKey',
        message: `moduleKey '${String(input.moduleKey)}' incompatível com ${catalogItem.eventName} (esperado: ${catalogItem.moduleKey}).`,
      });
    }

    // source
    if (input.source === undefined || input.source === null) {
      missing('source');
    } else if (!isPlainObject(input.source)) {
      invalid('source', 'source deve ser um objeto.');
    } else {
      for (const field of ['module', 'entityType', 'entityId'] as const) {
        if (!isNonEmptyString(input.source[field])) {
          invalid(
            `source.${field}`,
            `source.${field} deve ser uma string não vazia.`,
          );
        }
      }
    }

    // correlation
    if (input.correlation === undefined || input.correlation === null) {
      missing('correlation');
    } else if (!isPlainObject(input.correlation)) {
      invalid('correlation', 'correlation deve ser um objeto.');
    } else if (!isNonEmptyString(input.correlation.correlationId)) {
      invalid(
        'correlation.correlationId',
        'correlation.correlationId deve ser uma string não vazia.',
      );
    }

    // payload
    if (input.payload === undefined || input.payload === null) {
      missing('payload');
    } else if (!isPlainObject(input.payload)) {
      invalid('payload', 'payload deve ser um objeto JSON.');
    }

    // metadata
    if (input.metadata === undefined || input.metadata === null) {
      missing('metadata');
    } else if (!isPlainObject(input.metadata)) {
      invalid('metadata', 'metadata deve ser um objeto.');
    } else if (typeof input.metadata.schemaVersion !== 'number') {
      invalid(
        'metadata.schemaVersion',
        'metadata.schemaVersion deve ser um número.',
      );
    }

    // actor (opcional)
    if (input.actor !== undefined && input.actor !== null) {
      if (!isPlainObject(input.actor)) {
        invalid('actor', 'actor, quando presente, deve ser um objeto.');
      } else if (
        !LEADFLOW_EVENT_ACTOR_TYPES.includes(
          input.actor.type as (typeof LEADFLOW_EVENT_ACTOR_TYPES)[number],
        )
      ) {
        invalid(
          'actor.type',
          `actor.type deve ser um de: ${LEADFLOW_EVENT_ACTOR_TYPES.join(', ')}.`,
        );
      }
    }

    // context (opcional no envelope, mas o catálogo pode exigir ids)
    const context =
      input.context !== undefined &&
      input.context !== null &&
      isPlainObject(input.context)
        ? input.context
        : null;
    if (input.context !== undefined && input.context !== null && !context) {
      invalid('context', 'context, quando presente, deve ser um objeto.');
    }

    if (catalogItem) {
      for (const requiredKey of catalogItem.requiredContext) {
        if (!isNonEmptyString(context?.[requiredKey])) {
          errors.push({
            code: 'missing_required_context',
            field: `context.${requiredKey}`,
            message: `${catalogItem.eventName} exige context.${requiredKey}.`,
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      eventName,
      catalogStatus: catalogItem?.status ?? null,
      errors,
    };
  }
}
