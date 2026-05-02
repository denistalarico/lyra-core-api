import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';

@Injectable()
export class HybridAuthGuard implements CanActivate {
  private jwtGuard = new JwtAuthGuard();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    const hasAuthorizationHeader =
      typeof request.headers['authorization'] === 'string' &&
      request.headers['authorization'].startsWith('Bearer ');

    // Se tiver JWT → valida
    if (hasAuthorizationHeader) {
      return (await this.jwtGuard.canActivate(context)) as boolean;
    }

    // Sem JWT → modo legacy (headers)
    return true;
  }
}
