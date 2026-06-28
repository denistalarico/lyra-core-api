import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { SalesNotificationPublisher } from '../crm/sales-notification.publisher';
import { DocumentPdfRendererService } from '../document-layouts/document-pdf-renderer.service';
import { DocumentLayoutsService } from '../document-layouts/document-layouts.service';
import {
  ChangeQuoteStatusDto,
  CreateQuoteDto,
  CreateQuoteItemDto,
  QuoteListQueryDto,
  UpdateQuoteDto,
  UpdateQuoteItemDto,
} from './dto/quote.dto';
import {
  QuoteEntity,
  QuoteItemEntity,
  QuoteStatus,
  QuoteStatusHistoryEntity,
  QuoteTemplateEntity,
  QuoteTemplateSectionEntity,
} from './entities/quote.entities';
import {
  GenerateInvoiceResult,
  QuoteInvoiceService,
} from './quote-invoice.service';

const AGENCY_CONNECTION = 'agency';

type AgencyContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string;
};

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    @InjectRepository(QuoteEntity, AGENCY_CONNECTION)
    private readonly quotesRepo: Repository<QuoteEntity>,
    @InjectRepository(QuoteItemEntity, AGENCY_CONNECTION)
    private readonly itemsRepo: Repository<QuoteItemEntity>,
    @InjectRepository(QuoteStatusHistoryEntity, AGENCY_CONNECTION)
    private readonly statusHistoryRepo: Repository<QuoteStatusHistoryEntity>,
    @InjectRepository(QuoteTemplateEntity, AGENCY_CONNECTION)
    private readonly templatesRepo: Repository<QuoteTemplateEntity>,
    @InjectRepository(QuoteTemplateSectionEntity, AGENCY_CONNECTION)
    private readonly templateSectionsRepo: Repository<QuoteTemplateSectionEntity>,
    private readonly documentLayoutsService: DocumentLayoutsService,
    private readonly documentPdfRenderer: DocumentPdfRendererService,
    private readonly salesNotificationPublisher: SalesNotificationPublisher,
    private readonly quoteInvoiceService: QuoteInvoiceService,
  ) {}

  health() {
    return {
      app: 'quotes',
      status: 'ok',
      strategy: 'shared-domain-agency-facade',
    };
  }

  async listTemplates(context: AgencyContext) {
    const templates = await this.templatesRepo.find({
      where: [
        { isSystem: true, status: 'active' },
        {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          status: 'active',
        },
      ],
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });

    const sections = await this.templateSectionsRepo.find({
      where: templates.map((template) => ({ templateId: template.id })),
      order: { position: 'ASC', createdAt: 'ASC' },
    });

    return templates.map((template) => ({
      ...template,
      sections: sections.filter(
        (section) => section.templateId === template.id,
      ),
    }));
  }

  async listQuotes(context: AgencyContext, query: QuoteListQueryDto = {}) {
    const where: Record<string, unknown> = {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
    };

    if (query.status) where.status = query.status;
    if (query.contactId) where.contactId = query.contactId;
    if (query.opportunityId) where.opportunityId = query.opportunityId;
    if (query.search) where.title = ILike(`%${query.search}%`);

    return this.quotesRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async getQuote(context: AgencyContext, id: string) {
    const quote = await this.findQuoteOrFail(context, id);
    const items = await this.itemsRepo.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        quoteId: quote.id,
      },
      order: { position: 'ASC', createdAt: 'ASC' },
    });

    const history = await this.statusHistoryRepo.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        quoteId: quote.id,
      },
      order: { changedAt: 'DESC' },
    });

    return {
      ...quote,
      items,
      statusHistory: history,
    };
  }

  async getQuotePreview(context: AgencyContext, id: string) {
    const quote = await this.getQuote(context, id);

    const template = quote.templateId
      ? await this.templatesRepo.findOne({
          where: [
            { id: quote.templateId, isSystem: true },
            {
              id: quote.templateId,
              tenantId: context.tenantId,
              workspaceId: context.workspaceId,
            },
          ],
        })
      : null;

    const sections = template
      ? await this.templateSectionsRepo.find({
          where: { templateId: template.id },
          order: { position: 'ASC', createdAt: 'ASC' },
        })
      : [];

    return {
      quote,
      template: template
        ? {
            ...template,
            sections,
          }
        : null,
      preview: {
        version: 'quote-preview-v1',
        title: quote.title,
        quoteNumber: quote.quoteNumber,
        status: quote.status,
        currency: quote.currency,
        validUntil: quote.validUntil,
        totals: {
          subtotalCents: quote.subtotalCents,
          discountCents: quote.discountCents,
          taxCents: quote.taxCents,
          totalCents: quote.totalCents,
          recurringTotalCents: quote.recurringTotalCents,
        },
        customer: {
          contactId: quote.contactId,
          companyContactId: quote.companyContactId,
        },
        crm: {
          opportunityId: quote.opportunityId,
        },
        content: {
          termsAndConditions: quote.termsAndConditions,
          internalNotes: quote.internalNotes,
        },
        pdf: {
          available: false,
          message:
            'PDF generation is not implemented yet. This payload is ready for the future PDF renderer.',
        },
      },
    };
  }

  async convertQuote(context: AgencyContext, id: string, reason?: string) {
    const quote = await this.findQuoteOrFail(context, id);

    if (quote.status !== 'accepted') {
      throw new BadRequestException('Only accepted quotes can be converted.');
    }

    const convertedQuote = await this.changeStatus(
      context,
      id,
      'converted',
      reason ?? 'Quote converted into order/contract placeholder.',
    );

    return {
      status: 'placeholder',
      quote: convertedQuote,
      conversion: {
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        target: 'order_contract_invoice_subscription',
        created: false,
        message:
          'Conversion placeholder created. Orders, contracts, invoices and subscriptions will be implemented in a future sprint.',
        nextSteps: [
          'Create Orders shared domain.',
          'Create Contracts shared domain or Agency-only contract facade.',
          'Create Finance integration for invoices and payment collection.',
          'Create subscription/recurrence binding for accepted recurring quote items.',
        ],
      },
    };
  }

  async expireQuote(context: AgencyContext, id: string, reason?: string) {
    return this.changeStatus(
      context,
      id,
      'expired',
      reason ?? 'Quote manually marked as expired.',
    );
  }

  async createPdf(context: AgencyContext, id: string) {
    const quote = await this.findQuoteOrFail(context, id);
    const items = await this.itemsRepo.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        quoteId: quote.id,
      },
      order: { position: 'ASC', createdAt: 'ASC' },
    });

    const layout = await this.documentLayoutsService.getDefaultLayout(context);
    const template = await this.documentLayoutsService.getSystemTemplateForType(
      layout.layoutType,
      'quote',
    );

    if (!template) {
      throw new NotFoundException('Document layout template not found.');
    }

    const buffer = await this.documentPdfRenderer.renderQuotePdf({
      quote,
      items,
      layout,
      template,
    });

    return {
      buffer,
      filename: this.buildQuotePdfFilename(quote.quoteNumber),
    };
  }

  async createQuote(context: AgencyContext, dto: CreateQuoteDto) {
    const quote = this.quotesRepo.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      quoteNumber: null,
      title: dto.title?.trim() || 'Nova cotação',
      templateId: dto.templateId ?? null,
      contactId: dto.contactId ?? null,
      companyContactId: dto.companyContactId ?? null,
      opportunityId: dto.opportunityId ?? null,
      currency: dto.currency ?? 'BRL',
      validUntil: dto.validUntil ?? null,
      internalNotes: dto.internalNotes ?? null,
      termsAndConditions: dto.termsAndConditions ?? null,
      createdByUserId: context.userId ?? null,
      updatedByUserId: context.userId ?? null,
      metadata: dto.metadata ?? {},
      status: 'draft',
    });

    const saved = await this.quotesRepo.save(quote);

    await this.recordStatusChange(
      context,
      saved.id,
      null,
      'draft',
      'Quote created.',
    );

    return this.getQuote(context, saved.id);
  }

  async duplicateQuote(context: AgencyContext, id: string) {
    const original = await this.findQuoteOrFail(context, id);

    const originalItems = await this.itemsRepo.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        quoteId: original.id,
      },
      order: { position: 'ASC', createdAt: 'ASC' },
    });

    const duplicated = this.quotesRepo.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      quoteNumber: null,
      title: `${original.quoteNumber || original.title} (cópia)`,
      templateId: original.templateId,
      contactId: original.contactId,
      companyContactId: original.companyContactId,
      opportunityId: original.opportunityId,
      currency: original.currency,
      validUntil: original.validUntil,
      internalNotes: original.internalNotes,
      termsAndConditions: original.termsAndConditions,
      createdByUserId: context.userId ?? null,
      updatedByUserId: context.userId ?? null,
      metadata: {
        ...(original.metadata ?? {}),
        duplicatedFromQuoteId: original.id,
        duplicatedFromQuoteNumber: original.quoteNumber,
      },
      status: 'draft',
    });

    const savedQuote = await this.quotesRepo.save(duplicated);

    if (originalItems.length > 0) {
      const duplicatedItems = originalItems.map((item) =>
        this.itemsRepo.create({
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          quoteId: savedQuote.id,
          salesItemId: item.salesItemId,
          name: item.name,
          description: item.description,
          type: item.type,
          currency: item.currency,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          setupPriceCents: item.setupPriceCents,
          recurringPriceCents: item.recurringPriceCents,
          discountType: item.discountType,
          discountValue: item.discountValue,
          taxRateBps: item.taxRateBps,
          taxType: item.taxType,
          taxValue: item.taxValue,
          subtotalCents: item.subtotalCents,
          discountCents: item.discountCents,
          taxCents: item.taxCents,
          totalCents: item.totalCents,
          recurringTotalCents: item.recurringTotalCents,
          recurrenceInterval: item.recurrenceInterval,
          position: item.position,
          metadata: {
            ...(item.metadata ?? {}),
            duplicatedFromQuoteItemId: item.id,
          },
        }),
      );

      await this.itemsRepo.save(duplicatedItems);
    }

    await this.recalculateQuoteTotals(context, savedQuote.id);
    await this.recordStatusChange(
      context,
      savedQuote.id,
      null,
      'draft',
      `Quote duplicated from ${original.quoteNumber || original.title}.`,
    );

    return this.getQuote(context, savedQuote.id);
  }

  async updateQuote(context: AgencyContext, id: string, dto: UpdateQuoteDto) {
    const quote = await this.findQuoteOrFail(context, id);
    const previousStatus = quote.status;

    Object.assign(quote, {
      ...dto,
      templateId:
        dto.templateId === undefined ? quote.templateId : dto.templateId,
      contactId: dto.contactId === undefined ? quote.contactId : dto.contactId,
      companyContactId:
        dto.companyContactId === undefined
          ? quote.companyContactId
          : dto.companyContactId,
      opportunityId:
        dto.opportunityId === undefined
          ? quote.opportunityId
          : dto.opportunityId,
      validUntil:
        dto.validUntil === undefined ? quote.validUntil : dto.validUntil,
      internalNotes:
        dto.internalNotes === undefined
          ? quote.internalNotes
          : dto.internalNotes,
      termsAndConditions:
        dto.termsAndConditions === undefined
          ? quote.termsAndConditions
          : dto.termsAndConditions,
      updatedByUserId: context.userId ?? quote.updatedByUserId,
      metadata: dto.metadata
        ? { ...(quote.metadata ?? {}), ...dto.metadata }
        : quote.metadata,
    });

    if (dto.status === 'accepted' && !quote.quoteNumber) {
      quote.quoteNumber = await this.generateQuoteNumber(context);
    }

    const saved = await this.quotesRepo.save(quote);

    if (dto.status && dto.status !== previousStatus) {
      await this.recordStatusChange(
        context,
        saved.id,
        previousStatus,
        dto.status,
        'Status changed manually.',
      );
    }

    return this.getQuote(context, saved.id);
  }

  async deleteQuote(context: AgencyContext, id: string) {
    const quote = await this.findQuoteOrFail(context, id);

    if (quote.status === 'accepted' || quote.status === 'converted') {
      throw new BadRequestException(
        'Accepted or converted quotes cannot be deleted.',
      );
    }

    await this.quotesRepo.remove(quote);

    return { deleted: true };
  }

  async addItem(
    context: AgencyContext,
    quoteId: string,
    dto: CreateQuoteItemDto,
  ) {
    const quote = await this.findQuoteOrFail(context, quoteId);

    const calculated = this.calculateItem({
      quantity: dto.quantity ?? 1,
      unitPriceCents: dto.unitPriceCents ?? 0,
      setupPriceCents: dto.setupPriceCents ?? 0,
      recurringPriceCents: dto.recurringPriceCents ?? 0,
      discountType: dto.discountType ?? 'none',
      discountValue: dto.discountValue ?? 0,
      taxRateBps: dto.taxRateBps ?? 0,
      taxType: dto.taxType ?? 'percentage',
      taxValue: dto.taxValue ?? dto.taxRateBps ?? 0,
    });

    // Snapshot the catalog item's financial defaults onto the quote line so
    // the future invoice keeps the configuration even if the catalog changes.
    const financialSnapshot =
      await this.quoteInvoiceService.buildItemFinancialSnapshot(
        context,
        dto.salesItemId,
      );
    const baseMetadata = dto.metadata ?? {};
    const itemMetadata = financialSnapshot
      ? {
          ...baseMetadata,
          financials: {
            ...financialSnapshot,
            ...((baseMetadata.financials as Record<string, unknown>) ?? {}),
          },
        }
      : baseMetadata;

    const item = this.itemsRepo.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      quoteId: quote.id,
      salesItemId: dto.salesItemId ?? null,
      name: dto.name,
      description: dto.description ?? null,
      type: dto.type ?? 'service',
      currency: dto.currency ?? quote.currency,
      quantity: dto.quantity ?? 1,
      unitPriceCents: dto.unitPriceCents ?? 0,
      setupPriceCents: dto.setupPriceCents ?? 0,
      recurringPriceCents: dto.recurringPriceCents ?? 0,
      discountType: dto.discountType ?? 'none',
      discountValue: dto.discountValue ?? 0,
      taxRateBps: dto.taxRateBps ?? 0,
      taxType: dto.taxType ?? 'percentage',
      taxValue: dto.taxValue ?? dto.taxRateBps ?? 0,
      subtotalCents: calculated.subtotalCents,
      discountCents: calculated.discountCents,
      taxCents: calculated.taxCents,
      totalCents: calculated.totalCents,
      recurringTotalCents: calculated.recurringTotalCents,
      recurrenceInterval: dto.recurrenceInterval ?? null,
      position: dto.position ?? 0,
      metadata: itemMetadata,
    });

    await this.itemsRepo.save(item);
    await this.recalculateQuoteTotals(context, quote.id);

    return this.getQuote(context, quote.id);
  }

  async updateItem(
    context: AgencyContext,
    quoteId: string,
    itemId: string,
    dto: UpdateQuoteItemDto,
  ) {
    await this.findQuoteOrFail(context, quoteId);

    const item = await this.itemsRepo.findOne({
      where: {
        id: itemId,
        quoteId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!item) {
      throw new NotFoundException('Quote item not found.');
    }

    const definedUpdates = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    );

    Object.assign(item, {
      ...definedUpdates,
      metadata: dto.metadata
        ? { ...(item.metadata ?? {}), ...dto.metadata }
        : item.metadata,
    });

    const calculated = this.calculateItem({
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      setupPriceCents: item.setupPriceCents,
      recurringPriceCents: item.recurringPriceCents,
      discountType: item.discountType,
      discountValue: item.discountValue,
      taxRateBps: item.taxRateBps,
      taxType: item.taxType,
      taxValue: item.taxValue,
    });

    Object.assign(item, calculated);

    await this.itemsRepo.save(item);
    await this.recalculateQuoteTotals(context, quoteId);

    return this.getQuote(context, quoteId);
  }

  async deleteItem(context: AgencyContext, quoteId: string, itemId: string) {
    await this.findQuoteOrFail(context, quoteId);

    const item = await this.itemsRepo.findOne({
      where: {
        id: itemId,
        quoteId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!item) {
      throw new NotFoundException('Quote item not found.');
    }

    await this.itemsRepo.remove(item);
    await this.recalculateQuoteTotals(context, quoteId);

    return this.getQuote(context, quoteId);
  }

  async sendQuote(
    context: AgencyContext,
    id: string,
    dto: ChangeQuoteStatusDto,
  ) {
    return this.changeStatus(context, id, 'sent', dto.reason ?? 'Quote sent.');
  }

  async acceptQuote(
    context: AgencyContext,
    id: string,
    dto: ChangeQuoteStatusDto,
  ) {
    const quote = await this.findQuoteOrFail(context, id);
    const previousStatus = quote.status;

    quote.status = 'accepted';
    if (!quote.quoteNumber) {
      quote.quoteNumber = await this.generateQuoteNumber(context);
    }
    quote.acceptedAt = new Date();
    quote.acceptedByName = dto.acceptedByName ?? null;
    quote.acceptedByEmail = dto.acceptedByEmail ?? null;
    quote.rejectedAt = null;
    quote.rejectionReason = null;
    quote.updatedByUserId = context.userId ?? quote.updatedByUserId;

    const saved = await this.quotesRepo.save(quote);
    const statusHistory = await this.recordStatusChange(
      context,
      saved.id,
      previousStatus,
      'accepted',
      dto.reason ?? 'Quote accepted.',
    );

    if (previousStatus !== 'accepted') {
      await this.salesNotificationPublisher.publishQuoteAccepted({
        resource: saved,
        actorUserId: context.userId ?? null,
        occurredAt: saved.acceptedAt ?? saved.updatedAt,
        statusHistory,
      });
    }

    // Approving a quote creates a Finance invoice in DRAFT (no ledger entry).
    // Best-effort and idempotent: a failure here never breaks the approval and
    // re-approving never duplicates the invoice. The clear outcome is surfaced
    // to the caller via `generatedInvoice` rather than being swallowed.
    const generatedInvoice = await this.generateInvoiceForAcceptedQuote(
      context,
      saved,
    );

    const detail = await this.getQuote(context, saved.id);
    return { ...detail, generatedInvoice };
  }

  private async generateInvoiceForAcceptedQuote(
    context: AgencyContext,
    quote: QuoteEntity,
  ): Promise<{
    status: 'created' | 'existing' | 'skipped' | 'error';
    invoiceId: string | null;
    invoiceNumber: string | null;
    message?: string;
  }> {
    try {
      const items = await this.itemsRepo.find({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          quoteId: quote.id,
        },
        order: { position: 'ASC', createdAt: 'ASC' },
      });

      const result: GenerateInvoiceResult =
        await this.quoteInvoiceService.getOrCreateDraftInvoiceForQuote(
          context,
          quote,
          items,
        );

      if (result.invoice) {
        await this.quotesRepo.update(
          {
            id: quote.id,
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
          },
          {
            metadata: {
              ...(quote.metadata ?? {}),
              generatedInvoiceId: result.invoice.id,
              generatedInvoiceNumber: result.invoice.invoiceNumber,
            },
          },
        );

        return {
          status: result.created ? 'created' : 'existing',
          invoiceId: result.invoice.id,
          invoiceNumber: result.invoice.invoiceNumber,
        };
      }

      return {
        status: 'skipped',
        invoiceId: null,
        invoiceNumber: null,
        message: 'Cotação sem itens; fatura não gerada.',
      };
    } catch (error) {
      this.logger.error(
        `Failed to generate draft invoice for quote ${quote.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        status: 'error',
        invoiceId: null,
        invoiceNumber: null,
        message:
          error instanceof Error
            ? error.message
            : 'Erro ao gerar fatura a partir da cotação.',
      };
    }
  }

  async rejectQuote(
    context: AgencyContext,
    id: string,
    dto: ChangeQuoteStatusDto,
  ) {
    const quote = await this.findQuoteOrFail(context, id);
    const previousStatus = quote.status;

    quote.status = 'rejected';
    quote.rejectedAt = new Date();
    quote.rejectionReason = dto.reason ?? null;
    quote.updatedByUserId = context.userId ?? quote.updatedByUserId;

    const saved = await this.quotesRepo.save(quote);
    const statusHistory = await this.recordStatusChange(
      context,
      saved.id,
      previousStatus,
      'rejected',
      dto.reason ?? 'Quote rejected.',
    );

    if (previousStatus !== 'rejected') {
      await this.salesNotificationPublisher.publishQuoteRejected({
        resource: saved,
        actorUserId: context.userId ?? null,
        occurredAt: saved.rejectedAt ?? saved.updatedAt,
        statusHistory,
      });
    }

    return this.getQuote(context, saved.id);
  }

  async archiveQuote(
    context: AgencyContext,
    id: string,
    dto: ChangeQuoteStatusDto,
  ) {
    return this.changeStatus(
      context,
      id,
      'archived',
      dto.reason ?? 'Quote archived.',
    );
  }

  private async changeStatus(
    context: AgencyContext,
    id: string,
    status: QuoteStatus,
    reason: string,
  ) {
    const quote = await this.findQuoteOrFail(context, id);
    const previousStatus = quote.status;

    quote.status = status;
    quote.updatedByUserId = context.userId ?? quote.updatedByUserId;

    const saved = await this.quotesRepo.save(quote);

    if (previousStatus !== status) {
      const statusHistory = await this.recordStatusChange(
        context,
        saved.id,
        previousStatus,
        status,
        reason,
      );

      if (status === 'sent') {
        await this.salesNotificationPublisher.publishQuoteSent({
          resource: saved,
          actorUserId: context.userId ?? null,
          occurredAt: saved.updatedAt,
          statusHistory,
        });
      }

      if (status === 'expired') {
        await this.salesNotificationPublisher.publishQuoteExpired({
          resource: saved,
          actorUserId: context.userId ?? null,
          occurredAt: saved.updatedAt,
          statusHistory,
        });
      }
    }

    return this.getQuote(context, saved.id);
  }

  private async findQuoteOrFail(context: AgencyContext, id: string) {
    const quote = await this.quotesRepo.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!quote) {
      throw new NotFoundException('Quote not found.');
    }

    return quote;
  }

  private async generateQuoteNumber(context: AgencyContext) {
    const year = new Date().getFullYear();
    const prefix = `Q-${year}-`;

    const count = await this.quotesRepo.count({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        quoteNumber: ILike(`${prefix}%`),
      },
    });

    return `${prefix}${String(count + 1).padStart(5, '0')}`;
  }

  private buildQuotePdfFilename(quoteNumber: string | null) {
    const safeQuoteNumber = (quoteNumber ?? '')
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return `quote-${safeQuoteNumber || 'document'}.pdf`;
  }

  private calculateItem(input: {
    quantity: number;
    unitPriceCents: number;
    setupPriceCents: number;
    recurringPriceCents: number;
    discountType: 'none' | 'fixed' | 'percentage';
    discountValue: number;
    taxRateBps: number;
    taxType?: 'fixed' | 'percentage';
    taxValue?: number;
  }) {
    const quantity = Math.max(1, input.quantity);
    const baseSubtotal =
      quantity * input.unitPriceCents + input.setupPriceCents;
    const recurringTotalCents = quantity * input.recurringPriceCents;

    let discountCents = 0;
    const discountableSubtotal = Math.max(0, baseSubtotal);

    if (input.discountType === 'fixed') {
      discountCents = Math.min(input.discountValue, discountableSubtotal);
    }

    if (input.discountType === 'percentage') {
      discountCents = Math.floor((discountableSubtotal * input.discountValue) / 10000);
    }

    const subtotalAfterDiscount = baseSubtotal - discountCents;
    const taxableSubtotal = Math.max(0, subtotalAfterDiscount);
    const taxCents =
      input.taxType === 'fixed'
        ? input.taxValue ?? 0
        : Math.floor((taxableSubtotal * input.taxRateBps) / 10000);
    const totalCents = subtotalAfterDiscount + taxCents;

    return {
      subtotalCents: baseSubtotal,
      discountCents,
      taxCents,
      totalCents,
      recurringTotalCents,
    };
  }

  private async recalculateQuoteTotals(
    context: AgencyContext,
    quoteId: string,
  ) {
    const quote = await this.findQuoteOrFail(context, quoteId);

    const items = await this.itemsRepo.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        quoteId,
      },
    });

    quote.subtotalCents = items.reduce(
      (sum, item) => sum + item.subtotalCents,
      0,
    );
    quote.discountCents = items.reduce(
      (sum, item) => sum + item.discountCents,
      0,
    );
    quote.taxCents = items.reduce((sum, item) => sum + item.taxCents, 0);
    quote.totalCents = items.reduce((sum, item) => sum + item.totalCents, 0);
    quote.recurringTotalCents = items.reduce(
      (sum, item) => sum + item.recurringTotalCents,
      0,
    );
    quote.updatedByUserId = context.userId ?? quote.updatedByUserId;

    await this.quotesRepo.save(quote);
  }

  private async recordStatusChange(
    context: AgencyContext,
    quoteId: string,
    fromStatus: QuoteStatus | null,
    toStatus: QuoteStatus,
    reason: string,
  ): Promise<QuoteStatusHistoryEntity> {
    const entry = this.statusHistoryRepo.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      quoteId,
      fromStatus,
      toStatus,
      reason,
      changedByUserId: context.userId ?? null,
      metadata: {},
    });

    return this.statusHistoryRepo.save(entry);
  }
}
