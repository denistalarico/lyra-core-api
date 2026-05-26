import { BadRequestException } from '@nestjs/common';
import { Request } from 'express';

export type FinanceRequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string | null;
};

export function getFinanceContext(req: Request): FinanceRequestContext {
  const tenantId = req.header('x-tenant-id');
  const workspaceId = req.header('x-workspace-id');
  const userId = req.header('x-user-id') ?? null;

  if (!tenantId || !workspaceId) {
    throw new BadRequestException(
      'Missing required headers: x-tenant-id and x-workspace-id',
    );
  }

  return {
    tenantId,
    workspaceId,
    userId,
  };
}
