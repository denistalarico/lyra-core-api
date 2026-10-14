import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  FinanceBillRecurrence,
  FinanceRecurringProfile,
  FinanceSetting,
} from '../entities';
import {
  FinanceBillRecurrenceStatus,
  FinanceRecurringProfileStatus,
} from '../enums';
import { FinanceBillingService } from './finance-billing.service';

@Injectable()
export class FinanceRecurrenceScheduler {
  private readonly logger = new Logger(FinanceRecurrenceScheduler.name);
  private running = false;

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly billing: FinanceBillingService,
  ) {}

  @Cron('0 0 * * * *', { timeZone: 'America/Sao_Paulo' })
  async generateDue() {
    if (this.running) return;
    this.running = true;
    try {
      const [bills, invoices] = await Promise.all([
        this.dataSource.getRepository(FinanceBillRecurrence).find({
          where: { status: FinanceBillRecurrenceStatus.Active, active: true },
          select: { tenantId: true, workspaceId: true },
        }),
        this.dataSource.getRepository(FinanceRecurringProfile).find({
          where: {
            status: FinanceRecurringProfileStatus.Active,
            autoGenerateInvoice: true,
          },
          select: { tenantId: true, workspaceId: true },
        }),
      ]);
      const scopes = new Map(
        [...bills, ...invoices].map(({ tenantId, workspaceId }) => [
          `${tenantId}:${workspaceId}`,
          { tenantId, workspaceId, userId: null },
        ]),
      );
      for (const ctx of scopes.values()) {
        for (const kind of ['bill', 'invoice'] as const) {
          try {
            if (kind === 'invoice') {
              const settings = await this.dataSource
                .getRepository(FinanceSetting)
                .findOne({
                  where: {
                    tenantId: ctx.tenantId,
                    workspaceId: ctx.workspaceId,
                  },
                });
              if (!settings?.autoGenerateRecurringInvoices) continue;
            }
            const result =
              kind === 'bill'
                ? await this.billing.generateDueBillRecurrences(ctx)
                : await this.billing.generateDueRecurringInvoices(ctx);
            if (result.skipped.length)
              this.logger.warn(
                `Finance recurrence ${kind} scope ${ctx.tenantId}/${ctx.workspaceId}: ${JSON.stringify(result.skipped)}`,
              );
          } catch (error) {
            this.logger.error(
              `Finance recurrence ${kind} failed for ${ctx.tenantId}/${ctx.workspaceId}`,
              error instanceof Error ? error.stack : String(error),
            );
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}
