import { Request } from 'express';
import type { ManagedContext } from '../../../common/context/request-context.interface';
import { AuthTokenPayload } from './auth-token-payload.type';

export interface AuthenticatedRequest extends Request {
  user: AuthTokenPayload;
  managedContext?: ManagedContext;
  /** Product/module levels resolved by the PermissionsGuard. */
  moduleAccess?: Record<string, 'manager' | 'member' | null>;
}
