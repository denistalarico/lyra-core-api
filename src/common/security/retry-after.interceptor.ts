import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { catchError, throwError, type Observable } from 'rxjs';
import { TooManyAuthAttemptsException } from './auth-rate-limit.service';

/** SEC-02 — turns a {@link TooManyAuthAttemptsException} into a `Retry-After` header. */
@Injectable()
export class RetryAfterInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof TooManyAuthAttemptsException) {
          context
            .switchToHttp()
            .getResponse<Response>()
            .setHeader('Retry-After', String(error.retryAfterSeconds));
        }
        return throwError(() => error);
      }),
    );
  }
}
