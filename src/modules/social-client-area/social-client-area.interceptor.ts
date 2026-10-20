import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { map } from 'rxjs';
import type { ClientAreaRequest } from '../client-area/client-area.types';
import { socialClientAreaRule } from './social-client-area.routes';

/**
 * CA10 — fields of the Social views that stay internal to the agency.
 *
 * The Social responses are already browser views (`views/*.ts`), so the audit
 * (§10.5) keeps their shape and removes, at any depth, what a client must not
 * read: scope ids of the agency, storage keys, the agency's AI/media cost and
 * provider telemetry, the composed prompt and worker internals. (The
 * Production link to the agency's Projects tasks is withheld by the service
 * itself for the client actor: `operationalWork.state='restricted'`.) Paths to Lyra media
 * routes, the company's own ids and `createdById` (Operator "own" gates)
 * stay. Streams (`@Res()`) never pass through here.
 */
export const SOCIAL_CLIENT_AREA_INTERNAL_KEYS: ReadonlySet<string> = new Set([
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'clientId',
  'managedTenantId',
  'storagePath',
  'storageKey',
  'cost',
  'costs',
  'costAmount',
  'costCents',
  'costCurrency',
  'costSource',
  'costStatus',
  'costIsEstimated',
  'costView',
  'selectedVersionAiCost',
  'contentTotalAiCost',
  'unitPrice',
  'pricingVersion',
  'usageMetrics',
  'usageQuantity',
  'usageUnit',
  'inputTokens',
  'outputTokens',
  'cachedInputTokens',
  'latencyMs',
  'effectivePrompt',
  'promptVersion',
  'requestFingerprint',
  'idempotencyKey',
  'providerMetadata',
  'providerJobId',
  'providerOperationId',
  'providerUpdatedAt',
  'providerAvatarId',
  'providerVoiceId',
  'providerModel',
  'providerId',
  'lockedAt',
  'lockedBy',
  'deadLetteredAt',
  'driverError',
]);

export function socialClientResponse(value: unknown, depth = 0): unknown {
  if (depth > 32 || value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value))
    return value.map((item) => socialClientResponse(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SOCIAL_CLIENT_AREA_INTERNAL_KEYS.has(key))
      .map(([key, item]) => [key, socialClientResponse(item, depth + 1)]),
  );
}

/** Global, inert unless the Bridge authenticated a client on a Social route. */
@Injectable()
export class SocialClientAreaInterceptor implements NestInterceptor {
  intercept(execution: ExecutionContext, next: CallHandler) {
    if (execution.getType() !== 'http') return next.handle();
    const request = execution.switchToHttp().getRequest<ClientAreaRequest>();
    const route = request.route as { path?: string } | undefined;
    if (
      !request.clientAreaContext ||
      !socialClientAreaRule(request.method, route?.path)
    )
      return next.handle();
    return next
      .handle()
      .pipe(map((value: unknown) => socialClientResponse(value)));
  }
}
