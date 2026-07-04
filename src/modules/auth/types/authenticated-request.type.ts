import { Request } from 'express';
import type { ManagedContext } from '../../../common/context/request-context.interface';
import { AuthTokenPayload } from './auth-token-payload.type';

export interface AuthenticatedRequest extends Request {
  user: AuthTokenPayload;
  managedContext?: ManagedContext;
}
