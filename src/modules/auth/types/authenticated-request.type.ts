import { Request } from 'express';
import { AuthTokenPayload } from './auth-token-payload.type';

export interface AuthenticatedRequest extends Request {
  user: AuthTokenPayload;
}
