import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  LeadFlowEventCatalogItemResponse,
  LeadFlowEventCatalogResponse,
} from '../dto/leadflow-event-response.dto';
import {
  getEventByName,
  LEADFLOW_AUTOMATION_TRIGGER_EVENT_MAPPINGS,
  LEADFLOW_EVENT_CATALOG,
  LEADFLOW_EVENT_STRUCTURAL_RULE,
  listEvents,
} from '../catalog/leadflow-event.catalog';
import type { LeadFlowEventCatalogItem } from '../types/leadflow-event.types';
import { LEADFLOW_EVENT_PRODUCT_KEY } from '../types/leadflow-event.types';
import { LEADFLOW_EVENT_CONTRACT_VERSION } from './leadflow-event-runtime-contract.service';

/**
 * Read-only access to the in-memory event catalog. No persistence, no
 * emission — this only documents which events exist.
 */
@Injectable()
export class LeadFlowEventCatalogService {
  listCatalog(): LeadFlowEventCatalogResponse {
    return {
      productKey: LEADFLOW_EVENT_PRODUCT_KEY,
      contractVersion: LEADFLOW_EVENT_CONTRACT_VERSION,
      totalCount: LEADFLOW_EVENT_CATALOG.length,
      structuralRule: LEADFLOW_EVENT_STRUCTURAL_RULE,
      items: listEvents(),
    };
  }

  getCatalogItem(eventName: string): LeadFlowEventCatalogItemResponse {
    const item = this.findByName(eventName);

    if (!item) {
      throw new NotFoundException(
        `Evento desconhecido no catálogo LeadFlow: ${eventName}`,
      );
    }

    return {
      item,
      relatedTriggers: LEADFLOW_AUTOMATION_TRIGGER_EVENT_MAPPINGS.filter(
        (mapping) => mapping.eventName === item.eventName,
      ),
    };
  }

  findByName(eventName: string): LeadFlowEventCatalogItem | undefined {
    return getEventByName(eventName);
  }
}
