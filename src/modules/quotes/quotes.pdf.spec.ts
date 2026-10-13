import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ContactEntity } from '../contacts/entities/contact.entity';
import { SalesNotificationPublisher } from '../crm/sales-notification.publisher';
import { DocumentLayoutsService } from '../document-layouts/document-layouts.service';
import { DocumentPdfRendererService } from '../document-layouts/document-pdf-renderer.service';
import {
  QuoteEntity,
  QuoteItemEntity,
  QuoteStatusHistoryEntity,
  QuoteTemplateEntity,
  QuoteTemplateSectionEntity,
} from './entities/quote.entities';
import { QuoteInvoiceService } from './quote-invoice.service';
import { QuotesService } from './quotes.service';

const context = { tenantId: 'tenant-1', workspaceId: 'workspace-1' };

describe('QuotesService — PDF customer resolution', () => {
  async function setup(
    options: {
      contactId?: string | null;
      metadata?: Record<string, unknown>;
      contactScope?: { tenantId: string; workspaceId: string };
    } = {},
  ) {
    const quote = {
      id: 'quote-1',
      ...context,
      quoteNumber: 'Q-2026-00001',
      contactId:
        options.contactId === undefined ? 'contact-1' : options.contactId,
      companyContactId: null,
      metadata: options.metadata ?? {},
    };
    const contact = {
      id: 'contact-1',
      ...(options.contactScope ?? context),
      displayName: 'Cliente Aurora',
    };
    // An in-memory repository that enforces all supplied scope conditions.
    // If production forgets tenant/workspace filters, the foreign contact is
    // returned and the non-disclosure test catches that mistake.
    const contactsRepo = {
      findOne: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          Object.entries(where).every(
            ([key, value]) => contact[key as keyof typeof contact] === value,
          )
            ? contact
            : null,
        ),
      ),
    };
    const renderer = {
      renderQuotePdf: jest
        .fn<
          ReturnType<DocumentPdfRendererService['renderQuotePdf']>,
          Parameters<DocumentPdfRendererService['renderQuotePdf']>
        >()
        .mockResolvedValue(Buffer.from('offline-pdf')),
    };
    const module = await Test.createTestingModule({
      providers: [
        QuotesService,
        {
          provide: getRepositoryToken(QuoteEntity, 'agency'),
          useValue: { findOne: jest.fn().mockResolvedValue(quote) },
        },
        {
          provide: getRepositoryToken(QuoteItemEntity, 'agency'),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        ...[
          QuoteStatusHistoryEntity,
          QuoteTemplateEntity,
          QuoteTemplateSectionEntity,
        ].map((entity) => ({
          provide: getRepositoryToken(entity, 'agency'),
          useValue: {},
        })),
        {
          provide: getRepositoryToken(ContactEntity, 'agency'),
          useValue: contactsRepo,
        },
        {
          provide: DocumentLayoutsService,
          useValue: {
            getDefaultLayout: jest
              .fn()
              .mockResolvedValue({ layoutType: 'essence' }),
            getSystemTemplateForType: jest
              .fn()
              .mockResolvedValue({ htmlTemplate: '' }),
          },
        },
        { provide: DocumentPdfRendererService, useValue: renderer },
        { provide: SalesNotificationPublisher, useValue: {} },
        { provide: QuoteInvoiceService, useValue: {} },
      ],
    }).compile();
    const result = await module.get(QuotesService).createPdf(context, quote.id);
    await module.close();
    return { contactsRepo, renderer, result, quote };
  }

  it('renders the selected contact name even when quote metadata has no name', async () => {
    const { contactsRepo, renderer, result } = await setup();

    expect(contactsRepo.findOne.mock.calls[0]?.[0].where).toEqual(
      expect.objectContaining({ id: 'contact-1', ...context }),
    );
    expect(renderer.renderQuotePdf.mock.calls[0][0].customerName).toBe(
      'Cliente Aurora',
    );
    expect(result.filename).toBe('quote-Q-2026-00001.pdf');
    expect(result.buffer.toString()).toBe('offline-pdf');
  });

  it('uses the current contact instead of a stale metadata name without mutating the quote', async () => {
    const { renderer, quote } = await setup({
      metadata: { customerName: 'Nome antigo' },
    });

    expect(renderer.renderQuotePdf.mock.calls[0][0].customerName).toBe(
      'Cliente Aurora',
    );
    expect(quote.metadata).toEqual({ customerName: 'Nome antigo' });
  });

  it.each([
    { tenantId: 'tenant-2', workspaceId: 'workspace-1' },
    { tenantId: 'tenant-1', workspaceId: 'workspace-2' },
  ])(
    'does not disclose a contact from another scope: %j',
    async (contactScope) => {
      const { contactsRepo, renderer } = await setup({ contactScope });

      expect(contactsRepo.findOne.mock.calls[0]?.[0].where).toEqual(
        expect.objectContaining({ id: 'contact-1', ...context }),
      );
      expect(renderer.renderQuotePdf.mock.calls[0][0].customerName).not.toBe(
        'Cliente Aurora',
      );
    },
  );

  it('keeps generating PDFs without attempting a contact lookup when no contact is selected', async () => {
    const { contactsRepo, result } = await setup({ contactId: null });

    expect(contactsRepo.findOne).not.toHaveBeenCalled();
    expect(result.buffer.toString()).toBe('offline-pdf');
  });
});
