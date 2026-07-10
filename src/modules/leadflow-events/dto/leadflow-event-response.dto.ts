import type { LeadFlowEventStatus } from '../enums/leadflow-event-status.enum';
import type {
  LeadFlowEventCatalogItem,
  LeadFlowEventProductKey,
  LeadFlowEventRuntimeContract,
  LeadFlowEventStructuralRule,
  LeadFlowEventTriggerMapping,
} from '../types/leadflow-event.types';

/** GET /leadflow/events/catalog */
export interface LeadFlowEventCatalogResponse {
  productKey: LeadFlowEventProductKey;
  contractVersion: number;
  totalCount: number;
  structuralRule: LeadFlowEventStructuralRule;
  items: LeadFlowEventCatalogItem[];
}

/** GET /leadflow/events/catalog/:eventName */
export interface LeadFlowEventCatalogItemResponse {
  item: LeadFlowEventCatalogItem;
  /** Automations triggers contractually mapped to this event. */
  relatedTriggers: LeadFlowEventTriggerMapping[];
}

export type LeadFlowEventValidationErrorCode =
  | 'missing_field'
  | 'invalid_field'
  | 'unknown_event'
  | 'unsupported_version'
  | 'invalid_product_key'
  | 'incompatible_module_key'
  | 'missing_required_context';

export interface LeadFlowEventValidationError {
  code: LeadFlowEventValidationErrorCode;
  field: string;
  message: string;
}

/** POST /leadflow/events/validate — never persists nor executes anything. */
export interface LeadFlowEventValidationResponse {
  valid: boolean;
  eventName: string | null;
  /** Catalog status of the event, when it is known. */
  catalogStatus: LeadFlowEventStatus | null;
  errors: LeadFlowEventValidationError[];
}

/** GET /leadflow/events/runtime-contract */
export type LeadFlowEventRuntimeContractResponse = LeadFlowEventRuntimeContract;
