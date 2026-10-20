import {
  Injectable,
  NotFoundException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { map } from 'rxjs';
import type { ClientAreaRequest } from '../client-area/client-area.types';
import {
  leadFlowClientAreaRoute,
  type LeadFlowClientRoute,
} from './leadflow-client-area.routes';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
// Agency contact graph (detail and list rows): workspace data, not the company's lead record.
const agencyContactGraph = [
  'bankAccounts',
  'banks',
  'tags',
  'relatedContacts',
  'relatedCompanies',
];

/**
 * CA11.1 (D-02 revisada) — the client receives the same JSON the Agency domain serializer
 * returns. This only removes what is outside the company or reserved to developers; it is
 * never a field-by-field contract:
 * - Agenda: workspace Activities are not company items.
 * - Conversation with an internal (agency team) contact: the contact link is not the company's.
 * - Contact detail: the agency contact graph (bank data, workspace tags, related records).
 * - Developer material (catalog `developerOnly`, agent `developerOverrides`): developer powers
 *   never cross this surface.
 */
export function leadFlowClientResponse(
  value: unknown,
  route: LeadFlowClientRoute,
): unknown {
  if (Array.isArray(value))
    return value.map((row) => leadFlowClientResponse(row, route));
  if (!object(value)) return value;
  const row = value;
  if (route.kind === 'agenda' && Array.isArray(row.items))
    return {
      ...row,
      items: row.items.filter(
        (entry) => object(entry) && entry.source === 'scheduled_item',
      ),
    };
  if (Array.isArray(row.items))
    return { ...row, items: leadFlowClientResponse(row.items, route) };
  if (route.kind === 'catalog' && Array.isArray(row.fields))
    return {
      ...row,
      fields: row.fields.filter(
        (entry) => !(object(entry) && entry.developerOnly === true),
      ),
    };
  if (route.kind === 'contact')
    return Object.fromEntries(
      Object.entries(row).filter(([key]) => !agencyContactGraph.includes(key)),
    );
  if (route.kind === 'conversation' && row.qualificationStatus === 'internal')
    return { ...row, contactId: null };
  if (route.kind === 'outbound' && object(row.conversation))
    return {
      ...row,
      conversation: leadFlowClientResponse(row.conversation, {
        ...route,
        kind: 'conversation',
      }),
    };
  if (route.kind === 'agent' && object(row.promptConfig)) {
    const promptConfig = { ...row.promptConfig };
    delete promptConfig.developerOverrides;
    return { ...row, promptConfig };
  }
  return row;
}
@Injectable()
export class LeadFlowClientAreaInterceptor implements NestInterceptor {
  intercept(execution: ExecutionContext, next: CallHandler) {
    const request = execution.switchToHttp().getRequest<ClientAreaRequest>();
    if (!request.clientAreaContext) return next.handle();
    const route = leadFlowClientAreaRoute(
      request.method,
      (request.route as { path?: string })?.path ?? '',
    );
    if (!route) return next.handle();
    // Guards predate Multer; parsed media intent is checked again in its product controller.
    if (!request.clientAreaContext.memberAccess?.[route.module]?.available)
      throw new NotFoundException('Resource is not available.');
    return next
      .handle()
      .pipe(map((value: unknown) => leadFlowClientResponse(value, route)));
  }
}
