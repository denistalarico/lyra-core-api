import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AgencySalesItemEntity } from '../agency/entities/agency-sales.entities';
import { AgencyClient } from '../clients/entities';
import { CreateFinanceInvoiceDto, FinanceInvoiceLineInputDto } from '../finance/dto';
import {
  FinanceCategory,
  FinanceCostCenter,
  FinanceInvoice,
} from '../finance/entities';
import { FinanceCategoryType, FinanceCostCenterType } from '../finance/enums';
import { FinanceBillingService } from '../finance/services/finance-billing.service';
import { FinanceRequestContext } from '../finance/services/finance-context';
import { QuoteEntity, QuoteItemEntity } from './entities/quote.entities';

const AGENCY_CONNECTION = 'agency';

/**
 * Source markers stored on the generated invoice so the Sales → Finance link is
 * traceable and idempotent. `sourceModule`/`sourceId` already exist on
 * FinanceInvoice and are reused as the idempotency key (no migration needed).
 */
export const QUOTE_INVOICE_SOURCE_MODULE = 'sales_quote';

export type CostCenterStrategy =
  | 'use_client_cost_center'
  | 'use_project_cost_center'
  | 'fixed_cost_center'
  | 'manual'
  | 'none';

/**
 * Financial defaults configured on a product/service/plan and snapshotted onto
 * the quote item. They are stored inside the `metadata` jsonb (the catalog
 * already keeps revenueAccount/expenseAccount there), so adding the remaining
 * defaults requires no schema change.
 */
export interface ItemFinancials {
  revenueAccountId: string | null;
  revenueCategoryId: string | null;
  expenseAccountId: string | null;
  expenseCategoryId: string | null;
  costCenterStrategy: CostCenterStrategy | null;
  fixedCostCenterId: string | null;
  salesJournalId: string | null;
  purchaseJournalId: string | null;
}

export interface GenerateInvoiceResult {
  invoice: FinanceInvoice | null;
  created: boolean;
  skipped?: 'no_items';
}

type AgencyContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string;
};

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function centsToMoney(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

/**
 * Resolves the financial configuration carried by a quote item and turns the
 * approved quote into a Finance draft invoice. Kept separate from QuotesService
 * so the (recently validated) FinanceBillingService/FinancePostingService stay
 * untouched and the integration is independently testable.
 */
@Injectable()
export class QuoteInvoiceService {
  private readonly logger = new Logger(QuoteInvoiceService.name);

  constructor(
    private readonly financeBillingService: FinanceBillingService,
    @InjectRepository(FinanceInvoice, AGENCY_CONNECTION)
    private readonly invoicesRepo: Repository<FinanceInvoice>,
    @InjectRepository(FinanceCostCenter, AGENCY_CONNECTION)
    private readonly costCentersRepo: Repository<FinanceCostCenter>,
    @InjectRepository(FinanceCategory, AGENCY_CONNECTION)
    private readonly categoriesRepo: Repository<FinanceCategory>,
    @InjectRepository(AgencySalesItemEntity, AGENCY_CONNECTION)
    private readonly salesItemsRepo: Repository<AgencySalesItemEntity>,
    @InjectRepository(AgencyClient, AGENCY_CONNECTION)
    private readonly clientsRepo: Repository<AgencyClient>,
  ) {}

  /** Finds the invoice already generated for a quote, if any (idempotency). */
  async findInvoiceForQuote(
    context: AgencyContext,
    quoteId: string,
  ): Promise<FinanceInvoice | null> {
    return this.invoicesRepo.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        sourceModule: QUOTE_INVOICE_SOURCE_MODULE,
        sourceId: quoteId,
      },
    });
  }

  /**
   * Returns the existing draft invoice for the quote or creates a new one.
   * Never throws on a financial-config gap (cost center / category resolution
   * is best-effort); the draft can always be reviewed before confirmation.
   */
  async getOrCreateDraftInvoiceForQuote(
    context: AgencyContext,
    quote: QuoteEntity,
    items: QuoteItemEntity[],
  ): Promise<GenerateInvoiceResult> {
    const existing = await this.findInvoiceForQuote(context, quote.id);
    if (existing) {
      return { invoice: existing, created: false };
    }

    if (!items.length) {
      return { invoice: null, created: false, skipped: 'no_items' };
    }

    const financeCtx: FinanceRequestContext = {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      userId: context.userId ?? null,
    };

    const { lines, recurring } = await this.buildLines(context, quote, items);

    if (!lines.length) {
      return { invoice: null, created: false, skipped: 'no_items' };
    }

    const customerId = quote.companyContactId ?? quote.contactId ?? null;

    const dto: CreateFinanceInvoiceDto = {
      customerId,
      sourceModule: QUOTE_INVOICE_SOURCE_MODULE,
      sourceId: quote.id,
      currency: (quote.currency || 'BRL').slice(0, 3),
      issueDate: null,
      dueDate: quote.validUntil ?? null,
      terms: quote.termsAndConditions ?? null,
      notes: `Gerada a partir da cotação ${quote.quoteNumber ?? quote.id}`,
      metadata: {
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        createdVia: 'quote_approval',
        createdByUserId: context.userId ?? null,
        recurrence: recurring.length
          ? {
              hasRecurring: true,
              items: recurring,
              note:
                'Configure a recorrência manualmente antes de confirmar a fatura. ' +
                'A aprovação da cotação não cria recorrências nem lançamentos automáticos.',
            }
          : { hasRecurring: false },
      },
      lines,
    };

    const invoice = await this.financeBillingService.createInvoice(
      financeCtx,
      dto,
    );

    return { invoice, created: true };
  }

  /**
   * Reads the financial defaults snapshot for a sales item so it can be stored
   * on the quote item at add-time. Returns the raw key/value pairs (UUID
   * strings) to merge into `quoteItem.metadata.financials`.
   */
  async buildItemFinancialSnapshot(
    context: AgencyContext,
    salesItemId: string | null | undefined,
  ): Promise<Record<string, string> | null> {
    if (!salesItemId) return null;

    const salesItem = await this.salesItemsRepo.findOne({
      where: {
        id: salesItemId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });
    if (!salesItem) return null;

    const fin = this.extractFinancials(salesItem.metadata);
    const snapshot: Record<string, string> = {};
    if (fin.revenueAccountId) snapshot.revenueAccount = fin.revenueAccountId;
    if (fin.revenueCategoryId) snapshot.revenueCategory = fin.revenueCategoryId;
    if (fin.expenseAccountId) snapshot.expenseAccount = fin.expenseAccountId;
    if (fin.expenseCategoryId) snapshot.expenseCategory = fin.expenseCategoryId;
    if (fin.costCenterStrategy)
      snapshot.costCenterStrategy = fin.costCenterStrategy;
    if (fin.fixedCostCenterId) snapshot.fixedCostCenter = fin.fixedCostCenterId;
    if (fin.salesJournalId) snapshot.salesJournal = fin.salesJournalId;
    if (fin.purchaseJournalId) snapshot.purchaseJournal = fin.purchaseJournalId;

    return Object.keys(snapshot).length > 0 ? snapshot : null;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async buildLines(
    context: AgencyContext,
    quote: QuoteEntity,
    items: QuoteItemEntity[],
  ): Promise<{
    lines: FinanceInvoiceLineInputDto[];
    recurring: Array<Record<string, unknown>>;
  }> {
    const ordered = [...items].sort((a, b) => a.position - b.position);
    const lines: FinanceInvoiceLineInputDto[] = [];
    const recurring: Array<Record<string, unknown>> = [];

    for (const item of ordered) {
      const fin = await this.resolveItemFinancials(context, item);
      const categoryId = await this.resolveRevenueCategoryId(
        context,
        fin.revenueCategoryId,
      );
      const costCenterId = await this.resolveCostCenterId(context, fin, quote);

      const productId = item.type === 'product' ? item.salesItemId : null;
      const serviceId = item.type !== 'product' ? item.salesItemId : null;

      const baseMetadata: Record<string, unknown> = {
        sourceModule: QUOTE_INVOICE_SOURCE_MODULE,
        sourceQuoteId: quote.id,
        sourceQuoteLineId: item.id,
        salesItemId: item.salesItemId,
        itemType: item.type,
        revenueAccountId: fin.revenueAccountId,
        revenueCategoryId: fin.revenueCategoryId,
        costCenterStrategy: fin.costCenterStrategy,
        salesJournalId: fin.salesJournalId,
      };

      const hasOneTime = item.unitPriceCents > 0;
      const hasSetup = item.setupPriceCents > 0;
      const hasRecurring = item.recurringPriceCents > 0;

      if (hasOneTime || (!hasSetup && !hasRecurring)) {
        lines.push({
          productId,
          serviceId,
          description: item.name,
          quantity: String(Math.max(1, item.quantity)),
          unitPrice: centsToMoney(item.unitPriceCents),
          discountAmount: centsToMoney(item.discountCents),
          taxAmount: centsToMoney(item.taxCents),
          categoryId,
          costCenterId,
          metadata: { ...baseMetadata },
        });
      } else if (hasRecurring && !hasOneTime && !hasSetup) {
        // Pure recurring item (e.g. a plan): bill the first period now so the
        // draft is not zero-valued. Future periods are NOT generated here.
        lines.push({
          productId,
          serviceId,
          description: item.name,
          quantity: String(Math.max(1, item.quantity)),
          unitPrice: centsToMoney(item.recurringPriceCents),
          discountAmount: centsToMoney(item.discountCents),
          taxAmount: centsToMoney(item.taxCents),
          categoryId,
          costCenterId,
          metadata: {
            ...baseMetadata,
            billedAs: 'recurring_first_period',
            recurrenceInterval: item.recurrenceInterval,
          },
        });
      }

      if (hasSetup) {
        lines.push({
          productId,
          serviceId,
          description: `Setup — ${item.name}`,
          quantity: '1',
          unitPrice: centsToMoney(item.setupPriceCents),
          discountAmount: '0',
          taxAmount: '0',
          categoryId,
          costCenterId,
          metadata: { ...baseMetadata, kind: 'setup' },
        });
      }

      if (hasRecurring) {
        recurring.push({
          name: item.name,
          salesItemId: item.salesItemId,
          sourceQuoteLineId: item.id,
          interval: item.recurrenceInterval,
          quantity: item.quantity,
          unitAmount: centsToMoney(item.recurringPriceCents),
        });
      }
    }

    return { lines, recurring };
  }

  /**
   * Reads the financial snapshot from the quote item metadata, falling back to
   * the catalog item when the quote was created before the snapshot existed.
   */
  private async resolveItemFinancials(
    context: AgencyContext,
    item: QuoteItemEntity,
  ): Promise<ItemFinancials> {
    let fin = this.extractFinancials(item.metadata);

    const missing =
      !fin.revenueCategoryId &&
      !fin.revenueAccountId &&
      !fin.costCenterStrategy &&
      !fin.fixedCostCenterId;

    if (missing && item.salesItemId) {
      const salesItem = await this.salesItemsRepo.findOne({
        where: {
          id: item.salesItemId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });
      if (salesItem) {
        fin = this.extractFinancials(salesItem.metadata);
      }
    }

    return fin;
  }

  private extractFinancials(
    metadata: Record<string, unknown> | null | undefined,
  ): ItemFinancials {
    const root = metadata ?? {};
    const nested =
      (root.financials as Record<string, unknown> | undefined) ?? {};
    const read = (key: string): string | null =>
      asString(nested[key]) ?? asString(root[key]);

    const strategy = read('costCenterStrategy');

    return {
      revenueAccountId: read('revenueAccount'),
      revenueCategoryId: read('revenueCategory'),
      expenseAccountId: read('expenseAccount'),
      expenseCategoryId: read('expenseCategory'),
      costCenterStrategy: (strategy as CostCenterStrategy | null) ?? null,
      fixedCostCenterId: read('fixedCostCenter'),
      salesJournalId: read('salesJournal'),
      purchaseJournalId: read('purchaseJournal'),
    };
  }

  /**
   * Validates that a configured revenue category exists for this tenant/
   * workspace. Posting later resolves the ledger account from the category;
   * an unknown category is dropped to null (posting then uses the default
   * revenue account) instead of producing a dangling reference.
   */
  private async resolveRevenueCategoryId(
    context: AgencyContext,
    categoryId: string | null,
  ): Promise<string | null> {
    if (!categoryId) return null;
    const category = await this.categoriesRepo.findOne({
      where: {
        id: categoryId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });
    // Only revenue categories belong on a customer invoice line; posting maps
    // the category to its ledger account. Anything else falls back to null so
    // posting uses the default revenue account.
    if (!category || category.type !== FinanceCategoryType.Revenue) {
      return null;
    }
    return categoryId;
  }

  /**
   * Best-effort cost-center resolution. Never blocks invoice creation: an
   * unresolved cost center is left empty for manual review (per spec).
   */
  private async resolveCostCenterId(
    context: AgencyContext,
    fin: ItemFinancials,
    quote: QuoteEntity,
  ): Promise<string | null> {
    const strategy = fin.costCenterStrategy ?? 'use_client_cost_center';

    if (strategy === 'fixed_cost_center') {
      return this.validateCostCenterId(context, fin.fixedCostCenterId);
    }

    if (strategy === 'use_client_cost_center') {
      return this.resolveClientCostCenterId(context, quote);
    }

    if (strategy === 'use_project_cost_center') {
      const projectId = asString((quote.metadata ?? {}).projectId);
      return this.findRelatedCostCenterId(
        context,
        FinanceCostCenterType.Project,
        projectId,
      );
    }

    return null;
  }

  /**
   * Resolves the client cost center for a quote. Cost centers are keyed by the
   * client id (`AgencyClient.id`), but a quote references agency contacts, so we
   * first map the quote's contact(s) to their client(s). Falls back to matching
   * the related entity id directly against the metadata/contact ids for
   * resilience.
   */
  private async resolveClientCostCenterId(
    context: AgencyContext,
    quote: QuoteEntity,
  ): Promise<string | null> {
    const metadata = quote.metadata ?? {};
    const contactIds = [quote.companyContactId, quote.contactId].filter(
      (value): value is string => Boolean(value),
    );

    const candidateClientIds = new Set<string>();
    const metaClientId =
      asString(metadata.clientId) ?? asString(metadata.customerId);
    if (metaClientId) candidateClientIds.add(metaClientId);

    if (contactIds.length) {
      const clients = await this.clientsRepo.find({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          contactId: In(contactIds),
        },
      });
      for (const client of clients) candidateClientIds.add(client.id);
    }

    // 1. Cost center keyed by the client id (the standard auto-provisioned link).
    for (const clientId of candidateClientIds) {
      const found = await this.findRelatedCostCenterId(
        context,
        FinanceCostCenterType.Client,
        clientId,
      );
      if (found) return found;
    }

    // 2. Fallback: cost center keyed directly by a contact id (legacy data).
    for (const contactId of contactIds) {
      const found = await this.findRelatedCostCenterId(
        context,
        FinanceCostCenterType.Client,
        contactId,
      );
      if (found) return found;
    }

    return null;
  }

  private async validateCostCenterId(
    context: AgencyContext,
    costCenterId: string | null,
  ): Promise<string | null> {
    if (!costCenterId) return null;
    const found = await this.costCentersRepo.findOne({
      where: {
        id: costCenterId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });
    return found ? costCenterId : null;
  }

  private async findRelatedCostCenterId(
    context: AgencyContext,
    type: FinanceCostCenterType,
    relatedEntityId: string | null,
  ): Promise<string | null> {
    if (!relatedEntityId) return null;
    const found = await this.costCentersRepo.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        type,
        relatedEntityId,
        active: true,
      },
    });
    return found?.id ?? null;
  }
}
