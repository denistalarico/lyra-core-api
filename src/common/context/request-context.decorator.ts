// src/common/context/request-context.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestContext } from './request-context.interface';

export const RequestContextData = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    const request = ctx.switchToHttp().getRequest();

    return {
      tenantId: request.headers['x-tenant-id'] as string,
      workspaceId: request.headers['x-workspace-id'] as string | undefined,
      userId: request.headers['x-user-id'] as string | undefined,
    };
  },
);
