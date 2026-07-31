import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CreateFinanceBankTransferDto } from '../dto';
import { FinanceBankAccount, FinanceBankTransfer } from '../entities';
import { FinanceBankTransferStatus } from '../enums';
import { FinanceRequestContext } from './finance-context';
import { FinancePostingService } from './finance-posting.service';

function money(value: string | number): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new BadRequestException(
      'O valor da transferência deve ser maior que zero.',
    );
  }
  return (Math.round(parsed * 100) / 100).toFixed(2);
}

@Injectable()
export class FinanceBankTransferService {
  constructor(
    @InjectRepository(FinanceBankTransfer, 'agency')
    private readonly transfersRepo: Repository<FinanceBankTransfer>,
    @InjectDataSource('agency')
    private readonly dataSource: DataSource,
    private readonly postingService: FinancePostingService,
  ) {}

  list(ctx: FinanceRequestContext) {
    return this.transfersRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
      order: {
        transferDate: 'DESC',
        createdAt: 'DESC',
      },
    });
  }

  async create(ctx: FinanceRequestContext, dto: CreateFinanceBankTransferDto) {
    if (dto.fromBankAccountId === dto.toBankAccountId) {
      throw new BadRequestException(
        'A conta de origem e a conta de destino devem ser diferentes.',
      );
    }
    const amount = money(dto.amount);

    return this.dataSource.transaction(async (manager) => {
      const [fromAccount, toAccount] = await Promise.all([
        this.findBankAccount(manager, ctx, dto.fromBankAccountId),
        this.findBankAccount(manager, ctx, dto.toBankAccountId),
      ]);

      if (fromAccount.active === false || toAccount.active === false) {
        throw new BadRequestException(
          'Transferências só podem usar contas financeiras ativas.',
        );
      }
      if (fromAccount.currency !== toAccount.currency) {
        throw new BadRequestException(
          'As contas da transferência devem usar a mesma moeda.',
        );
      }
      if (!fromAccount.accountId || !toAccount.accountId) {
        throw new BadRequestException(
          'Vincule as contas de origem e destino ao plano de contas antes de transferir.',
        );
      }

      const repo = manager.getRepository(FinanceBankTransfer);
      const transfer = await repo.save(
        repo.create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          fromBankAccountId: fromAccount.id,
          toBankAccountId: toAccount.id,
          transferDate: dto.transferDate,
          amount,
          currency: fromAccount.currency,
          description: dto.description?.trim() || null,
          status: FinanceBankTransferStatus.Completed,
          createdById: ctx.userId ?? null,
          reversedAt: null,
          reversedById: null,
          metadata: dto.metadata ?? {},
        }),
      );

      await this.postingService.postBankTransfer(ctx, transfer, manager);
      return transfer;
    });
  }

  async reverse(ctx: FinanceRequestContext, id: string) {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(FinanceBankTransfer);
      const transfer = await repo.findOne({
        where: {
          id,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!transfer) {
        throw new NotFoundException('Transferência não encontrada.');
      }
      if (transfer.status === FinanceBankTransferStatus.Reversed) {
        return transfer;
      }

      await this.postingService.reverseBankTransfer(ctx, transfer.id, manager);
      transfer.status = FinanceBankTransferStatus.Reversed;
      transfer.reversedAt = new Date();
      transfer.reversedById = ctx.userId ?? null;
      return repo.save(transfer);
    });
  }

  private async findBankAccount(
    manager: EntityManager,
    ctx: FinanceRequestContext,
    id: string,
  ) {
    const account = await manager.getRepository(FinanceBankAccount).findOne({
      where: {
        id,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });
    if (!account) {
      throw new NotFoundException('Conta financeira não encontrada.');
    }
    return account;
  }
}
