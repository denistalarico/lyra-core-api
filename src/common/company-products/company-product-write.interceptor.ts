import { AgencyClientStatus } from '../../modules/clients/enums';
import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, QueryFailedError } from 'typeorm';
import { defer, lastValueFrom, catchError } from 'rxjs';
import type { AuthenticatedRequest } from '../../modules/auth/types/authenticated-request.type';
import { AgencyClient } from '../../modules/clients/entities/agency-client.entity';
import { AgencyClientCompanyProduct } from '../../modules/clients/entities/agency-client-company-product.entity';

/** Checks server-resolved context after guards. The INSERT barriers in CA6's
 * migration serialize new publications/approvals with lifecycle transactions;
 * this interceptor never retains a connection for a whole request handler.
 */
@Injectable()
export class CompanyProductWriteInterceptor implements NestInterceptor {
  constructor(@InjectDataSource('agency') private readonly db: DataSource) {}
  intercept(context: ExecutionContext, next: CallHandler<unknown>) {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const mc = req.managedContext;
    // Product-management routes own their transaction/locks.
    if (/\/agency\/clients(?:\/|$)/.test(req.originalUrl ?? ''))
      return next.handle();
    if (
      mc?.operatingMode !== 'client' ||
      !mc.clientId ||
      !mc.companyContextId ||
      !['social', 'leadflow'].includes(mc.productKey)
    )
      return next.handle();
    const writing = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const check = async (manager: EntityManager) => {
      const client = await manager.getRepository(AgencyClient).findOne({
        where: {
          id: mc.clientId!,
          tenantId: req.user.tenantId,
          workspaceId: req.user.workspaceId,
        },
      });
      if (
        !client ||
        client.archivedAt ||
        client.status !== AgencyClientStatus.Active
      )
        throw new NotFoundException();
      if (writing && client.archiveStatus !== 'none')
        throw new ConflictException({
          code: 'client_archive_scheduled',
          message: 'Client archival is pending.',
        });
      const p = await manager
        .getRepository(AgencyClientCompanyProduct)
        .findOne({
          where: {
            tenantId: client.tenantId,
            workspaceId: client.workspaceId,
            agencyClientId: client.id,
            companyContextId: mc.companyContextId!,
            productKey: mc.productKey as 'leadflow' | 'social',
            status: In(['active', 'removal_scheduled', 'removal_blocked']),
          },
        });
      if (!p) throw new NotFoundException();
      if (writing && p.status !== 'active')
        throw new ConflictException({
          code: 'company_product_removal_scheduled',
          message: 'Company product removal is pending.',
        });
    };
    return defer(async () => {
      await check(this.db.manager);
      return lastValueFrom(next.handle());
    }).pipe(
      catchError((error: unknown) => {
        if (error instanceof QueryFailedError) {
          const driver = error.driverError as {
            code?: string;
            message?: string;
          };
          if (driver.code === 'P0409')
            throw new ConflictException({
              code: driver.message,
              message: 'Company product lifecycle changed. Refresh and retry.',
            });
          if (driver.code === 'P0404')
            throw new NotFoundException('Company product unavailable.');
        }
        throw error;
      }),
    );
  }
}
