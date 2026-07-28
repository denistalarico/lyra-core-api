import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import {
  getAdminWebOrigins,
  normalizeOrigin,
} from '../../../config/cors.config';

@Injectable()
export class AdminBrowserOriginGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const allowedOrigins = getAdminWebOrigins({
      ADMIN_WEB_ORIGIN: this.configService.get<string>('ADMIN_WEB_ORIGIN'),
      NODE_ENV: this.configService.get<string>('NODE_ENV'),
    });
    const requestOrigin = resolveRequestOrigin(request);

    if (
      requestOrigin.value &&
      allowedOrigins.includes(requestOrigin.value)
    ) {
      return true;
    }

    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    if (
      !requestOrigin.headerPresent &&
      (request.method === 'GET' || !isProduction)
    ) {
      return true;
    }

    throw new ForbiddenException('Administrative browser origin is not allowed.');
  }
}

function resolveRequestOrigin(request: Request): {
  headerPresent: boolean;
  value: string | null;
} {
  const originHeader = request.headers.origin;
  if (typeof originHeader === 'string') {
    return { headerPresent: true, value: normalizeOrigin(originHeader) };
  }

  const refererHeader = request.headers.referer;
  return typeof refererHeader === 'string'
    ? { headerPresent: true, value: normalizeOrigin(refererHeader) }
    : { headerPresent: false, value: null };
}
