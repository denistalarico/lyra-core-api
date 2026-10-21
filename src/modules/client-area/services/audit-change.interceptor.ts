import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';
import { randomUUID } from 'node:crypto';
import { concatMap } from 'rxjs';
import type { AuthenticatedRequest } from '../../auth/types/authenticated-request.type';
import type { ClientAreaRequest } from '../client-area.types';
import { isUuid } from '../client-area.types';
import { CLIENT_AREA_EXPOSED_METADATA } from '../../../common/client-area-bridge/client-area-bridge.registry';
import { AuditChangeService } from './audit-change.service';

@Injectable()
export class AuditChangeInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditChangeService,
  ) {}
  intercept(execution: ExecutionContext, next: CallHandler<unknown>) {
    const req = execution
      .switchToHttp()
      .getRequest<AuthenticatedRequest & ClientAreaRequest>();
    const exposed = this.reflector.get<string | undefined>(
      CLIENT_AREA_EXPOSED_METADATA,
      execution.getHandler(),
    );
    const prefix =
      this.reflector.get<string | undefined>(
        PATH_METADATA,
        execution.getClass(),
      ) ?? '';
    const route = req.route as { path?: unknown } | undefined;
    const path = typeof route?.path === 'string' ? route.path : '';
    const covered =
      exposed ||
      prefix.startsWith('client-area') ||
      prefix.startsWith('agency/client-area-management') ||
      (prefix.startsWith('agency/clients/') &&
        (path.includes('client-area') || prefix.includes('client-area')));
    if (!covered || ['GET', 'HEAD', 'OPTIONS'].includes(req.method))
      return next.handle();
    const ctx = req.clientAreaContext;
    const tenantId =
      ctx?.tenantId ?? req.clientAreaIdentity?.tenantId ?? req.user?.tenantId;
    if (!isUuid(tenantId)) return next.handle();
    const requestId = randomUUID();
    return next.handle().pipe(
      concatMap(async (value) => {
        const status = execution
          .switchToHttp()
          .getResponse<{ statusCode: number }>().statusCode;
        if (status >= 200 && status < 300) {
          const paramId = Object.values(req.params ?? {}).find((value) =>
            isUuid(value),
          );
          await this.audit.record({
            tenantId,
            workspaceId: ctx?.workspaceId ?? req.user?.workspaceId ?? null,
            agencyClientId:
              ctx?.agencyClientId ??
              req.managedContext?.clientId ??
              (isUuid(req.params.clientId) ? req.params.clientId : null),
            companyContextId:
              ctx?.companyContextId ??
              req.managedContext?.companyContextId ??
              (isUuid(req.params.companyContextId)
                ? req.params.companyContextId
                : null),
            actorUserId:
              ctx?.userId ??
              req.clientAreaIdentity?.userId ??
              (isUuid(req.user?.sub) ? req.user.sub : null),
            actorSurface:
              ctx || req.clientAreaIdentity ? 'client_area' : 'agency',
            moduleKey: exposed ?? 'settings',
            entityType: execution.getClass().name,
            entityId: isUuid(paramId) ? paramId : null,
            action:
              req.method === 'DELETE'
                ? 'delete'
                : req.method === 'POST'
                  ? 'state_change'
                  : 'update',
            changedFields:
              req.body &&
              typeof req.body === 'object' &&
              !Array.isArray(req.body)
                ? Object.keys(req.body as object).slice(0, 100)
                : [],
            requestId,
            ip: req.ip?.slice(0, 64) ?? null,
            userAgent: req.headers['user-agent']?.slice(0, 512) ?? null,
          });
        }
        return value;
      }),
    );
  }
}
