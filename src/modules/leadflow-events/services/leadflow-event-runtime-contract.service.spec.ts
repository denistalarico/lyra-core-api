import { NotFoundException } from '@nestjs/common';
import { LEADFLOW_EVENT_CATALOG } from '../catalog/leadflow-event.catalog';
import { LeadFlowEventCatalogService } from './leadflow-event-catalog.service';
import {
  LEADFLOW_EVENT_CONTRACT_VERSION,
  LeadFlowEventRuntimeContractService,
} from './leadflow-event-runtime-contract.service';

describe('LeadFlowEventRuntimeContractService', () => {
  let service: LeadFlowEventRuntimeContractService;

  beforeEach(() => {
    service = new LeadFlowEventRuntimeContractService();
  });

  it('builds the full versioned contract for the leadflow product', () => {
    const contract = service.buildRuntimeContract();

    expect(contract.productKey).toBe('leadflow');
    expect(contract.version).toBe(LEADFLOW_EVENT_CONTRACT_VERSION);
    expect(Date.parse(contract.generatedAt)).not.toBeNaN();
    expect(contract.namingConvention).toBe(
      'leadflow.<module>.<resource>.<action>',
    );
    expect(contract.catalog).toHaveLength(LEADFLOW_EVENT_CATALOG.length);
    expect(contract.envelopeSchema.length).toBeGreaterThan(0);
  });

  it('marks required and optional envelope fields per blueprint section 7', () => {
    const contract = service.buildRuntimeContract();
    const byField = new Map(
      contract.envelopeSchema.map((spec) => [spec.field, spec]),
    );

    for (const field of [
      'eventId',
      'eventName',
      'eventVersion',
      'occurredAt',
      'tenantId',
      'workspaceId',
      'productKey',
      'moduleKey',
      'source',
      'correlation',
      'payload',
      'metadata',
    ]) {
      expect(byField.get(field)?.required).toBe(true);
    }
    expect(byField.get('actor')?.required).toBe(false);
    expect(byField.get('context')?.required).toBe(false);
  });

  it('exposes the structural Inbox → CRM rule and trigger mappings', () => {
    const contract = service.buildRuntimeContract();

    expect(contract.structuralRules.everyConversationCreatesOpportunity).toBe(
      true,
    );
    expect(contract.automationTriggerMappings.length).toBeGreaterThan(0);
    expect(
      contract.automationTriggerMappings.some(
        (mapping) =>
          mapping.trigger === 'conversation.idle' &&
          mapping.eventName === 'leadflow.inbox.conversation.idle',
      ),
    ).toBe(true);
  });

  it('declares that no execution runtime exists', () => {
    const notice = service.buildRuntimeContract().unsupportedExecutionNotice;

    expect(notice.eventBus).toBe(true);
    expect(notice.persistence).toBe(true);
    expect(notice.execution).toBe(false);
    expect(notice.redis).toBe(false);
    expect(notice.temporal).toBe(false);
    expect(notice.n8n).toBe(false);
    expect(notice.llm).toBe(false);
  });

  it('never serializes secrets, tokens or raw prompt fields', () => {
    // The sensitive-data policy legitimately talks ABOUT secrets/prompts in
    // its values, so inspect object KEYS only.
    const forbiddenKey = /secret|token|apikey|password|prompt|credential/i;
    const collectKeys = (value: unknown, keys: string[] = []): string[] => {
      if (Array.isArray(value)) {
        value.forEach((entry) => collectKeys(entry, keys));
      } else if (typeof value === 'object' && value !== null) {
        for (const [key, nested] of Object.entries(value)) {
          keys.push(key);
          collectKeys(nested, keys);
        }
      }
      return keys;
    };

    for (const key of collectKeys(service.buildRuntimeContract())) {
      expect(key).not.toMatch(forbiddenKey);
    }
  });
});

describe('LeadFlowEventCatalogService', () => {
  let service: LeadFlowEventCatalogService;

  beforeEach(() => {
    service = new LeadFlowEventCatalogService();
  });

  it('lists the catalog with contract version and structural rule', () => {
    const response = service.listCatalog();

    expect(response.productKey).toBe('leadflow');
    expect(response.contractVersion).toBe(LEADFLOW_EVENT_CONTRACT_VERSION);
    expect(response.totalCount).toBe(LEADFLOW_EVENT_CATALOG.length);
    expect(response.items).toHaveLength(LEADFLOW_EVENT_CATALOG.length);
    expect(response.structuralRule.everyConversationCreatesOpportunity).toBe(
      true,
    );
  });

  it('returns one event with its related automation triggers', () => {
    const response = service.getCatalogItem('leadflow.inbox.conversation.idle');

    expect(response.item.eventName).toBe('leadflow.inbox.conversation.idle');
    expect(response.relatedTriggers).toContainEqual(
      expect.objectContaining({ trigger: 'conversation.idle' }),
    );
  });

  it('throws NotFound for an unknown event', () => {
    expect(() => service.getCatalogItem('leadflow.unknown.thing.done')).toThrow(
      NotFoundException,
    );
  });
});
