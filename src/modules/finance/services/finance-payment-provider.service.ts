import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CreateFinancePaymentProviderDto,
  UpdateFinancePaymentProviderDto,
} from '../dto';
import { FinancePaymentProvider } from '../entities';
import { FinancePaymentProviderStatus } from '../enums';
import { FinanceRequestContext } from './finance-context';

@Injectable()
export class FinancePaymentProviderService {
  constructor(
    @InjectRepository(FinancePaymentProvider, 'agency')
    private readonly providersRepo: Repository<FinancePaymentProvider>,
  ) {}

  list(ctx: FinanceRequestContext) {
    return this.providersRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
      order: {
        providerType: 'ASC',
        name: 'ASC',
      },
    });
  }

  async create(ctx: FinanceRequestContext, dto: CreateFinancePaymentProviderDto) {
    await this.clearDefaultsIfNeeded(ctx, {
      isDefaultForCustomerPayments: dto.isDefaultForCustomerPayments,
      isDefaultForVendorPayments: dto.isDefaultForVendorPayments,
    });

    const provider = this.providersRepo.create({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      name: dto.name,
      providerType: dto.providerType,
      environment: dto.environment,
      isDefaultForCustomerPayments: dto.isDefaultForCustomerPayments ?? false,
      isDefaultForVendorPayments: dto.isDefaultForVendorPayments ?? false,
      supportsPix: dto.supportsPix ?? false,
      supportsCard: dto.supportsCard ?? false,
      supportsBoleto: dto.supportsBoleto ?? false,
      supportsBankSlip: dto.supportsBankSlip ?? false,
      supportsBankTransfer: dto.supportsBankTransfer ?? false,
      publicKey: dto.publicKey ?? null,
      secretKeyEncrypted: dto.secretKeyEncrypted ?? null,
      accessTokenEncrypted: dto.accessTokenEncrypted ?? null,
      refreshTokenEncrypted: dto.refreshTokenEncrypted ?? null,
      webhookSecretEncrypted: dto.webhookSecretEncrypted ?? null,
      externalAccountId: dto.externalAccountId ?? null,
      config: dto.config ?? {},
      metadata: dto.metadata ?? {},
    });

    return this.providersRepo.save(provider);
  }

  async get(ctx: FinanceRequestContext, id: string) {
    const provider = await this.providersRepo.findOne({
      where: {
        id,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!provider) {
      throw new NotFoundException('Finance payment provider not found');
    }

    return provider;
  }

  async update(
    ctx: FinanceRequestContext,
    id: string,
    dto: UpdateFinancePaymentProviderDto,
  ) {
    const provider = await this.get(ctx, id);

    await this.clearDefaultsIfNeeded(ctx, {
      isDefaultForCustomerPayments: dto.isDefaultForCustomerPayments,
      isDefaultForVendorPayments: dto.isDefaultForVendorPayments,
      exceptId: provider.id,
    });

    Object.assign(provider, {
      ...dto,
      config: dto.config ?? provider.config,
      metadata: dto.metadata ?? provider.metadata,
    });

    return this.providersRepo.save(provider);
  }

  async connect(ctx: FinanceRequestContext, id: string) {
    const provider = await this.get(ctx, id);

    provider.status = FinancePaymentProviderStatus.Connected;
    provider.lastHealthCheckAt = new Date();
    provider.lastHealthCheckStatus = 'connected';
    provider.lastErrorMessage = null;

    return this.providersRepo.save(provider);
  }

  async disconnect(ctx: FinanceRequestContext, id: string) {
    const provider = await this.get(ctx, id);

    provider.status = FinancePaymentProviderStatus.Disconnected;
    provider.lastHealthCheckAt = new Date();
    provider.lastHealthCheckStatus = 'disconnected';

    return this.providersRepo.save(provider);
  }

  private async clearDefaultsIfNeeded(
    ctx: FinanceRequestContext,
    options: {
      isDefaultForCustomerPayments?: boolean;
      isDefaultForVendorPayments?: boolean;
      exceptId?: string;
    },
  ) {
    if (!options.isDefaultForCustomerPayments && !options.isDefaultForVendorPayments) {
      return;
    }

    const providers = await this.providersRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    const toUpdate = providers.filter((provider) => provider.id !== options.exceptId);

    for (const provider of toUpdate) {
      let changed = false;

      if (options.isDefaultForCustomerPayments && provider.isDefaultForCustomerPayments) {
        provider.isDefaultForCustomerPayments = false;
        changed = true;
      }

      if (options.isDefaultForVendorPayments && provider.isDefaultForVendorPayments) {
        provider.isDefaultForVendorPayments = false;
        changed = true;
      }

      if (changed) {
        await this.providersRepo.save(provider);
      }
    }
  }
}
