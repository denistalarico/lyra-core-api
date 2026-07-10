import { Allow } from 'class-validator';

/**
 * Raw envelope received by POST /leadflow/events/validate. Every field is
 * `@Allow()`ed (untyped) on purpose: the global ValidationPipe runs with
 * `whitelist + forbidNonWhitelisted`, and this endpoint's job is to produce
 * STRUCTURED validation errors itself (LeadFlowEventValidationService), not
 * to 400 on shape problems. Unknown extra fields are still rejected by the
 * pipe, which matches the fixed envelope contract.
 */
export class ValidateLeadFlowEventDto {
  @Allow()
  eventId?: unknown;

  @Allow()
  eventName?: unknown;

  @Allow()
  eventVersion?: unknown;

  @Allow()
  occurredAt?: unknown;

  @Allow()
  tenantId?: unknown;

  @Allow()
  workspaceId?: unknown;

  @Allow()
  productKey?: unknown;

  @Allow()
  moduleKey?: unknown;

  @Allow()
  source?: unknown;

  @Allow()
  actor?: unknown;

  @Allow()
  correlation?: unknown;

  @Allow()
  context?: unknown;

  @Allow()
  payload?: unknown;

  @Allow()
  metadata?: unknown;
}
