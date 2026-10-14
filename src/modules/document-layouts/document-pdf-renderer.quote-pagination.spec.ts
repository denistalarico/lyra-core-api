import { chromium } from 'playwright';
import pdfParse from 'pdf-parse';
import { DocumentPdfRendererService } from './document-pdf-renderer.service';
import { systemDocumentLayoutTemplates } from './document-layout-system-templates';
import type {
  DocumentLayoutEntity,
  DocumentLayoutTemplateEntity,
} from './entities/document-layout.entities';
import type {
  QuoteEntity,
  QuoteItemEntity,
} from '../quotes/entities/quote.entities';

describe('quote PDF repeating document layout', () => {
  it.each([
    ['essence', 'a4'],
    ['authority', 'letter'],
    ['frame', 'a4'],
    ['flow', 'letter'],
    ['orbit', 'a4'],
    ['pulse', 'letter'],
    ['signature', 'a4'],
  ] as const)(
    'repeats %s header and footer without overlapping %s page content',
    async (layoutType, paperFormat) => {
      const browser = await chromium.launch({ headless: true });
      try {
        // Offline fixture: real Chromium and real system model, no providers.
        const context = await browser.newContext();
        await context.route('**/*', (route) => route.abort());
        const renderer = new DocumentPdfRendererService();
        jest
          .spyOn(browser, 'newPage')
          .mockImplementation(() => context.newPage());
        jest
          .spyOn(
            renderer as unknown as {
              launchBrowser(): Promise<typeof browser>;
            },
            'launchBrowser',
          )
          .mockResolvedValue(browser);
        const pdf = await renderer.renderQuotePdf({
          quote: {
            quoteNumber: 'QUOTE-REPEATED',
            title: 'Commercial proposal',
            currency: 'BRL',
            metadata: {},
            subtotalCents: 600000,
            totalCents: 600000,
          } as QuoteEntity,
          items: Array.from({ length: 60 }, (_, index) => ({
            name: `ITEM-${String(index + 1).padStart(2, '0')}`,
            description: 'Delivery with scope, timeline and assistance.',
            quantity: 1,
            currency: 'BRL',
            unitPriceCents: 10000,
            totalCents: 10000,
            metadata: {},
          })) as QuoteItemEntity[],
          layout: {
            layoutType,
            paperFormat,
            companyName: 'REPEATING-AGENCY',
            companyAddress: 'REPEATING-AGENCY',
            companyEmail: 'fixture@example.test',
            logoUrl:
              'data:image/svg+xml;base64,' +
              Buffer.from(
                '<svg xmlns="http://www.w3.org/2000/svg" width="140" height="50"><rect width="140" height="50" fill="#2563eb"/><text x="10" y="32" fill="white" font-size="20">Fixture</text></svg>',
              ).toString('base64'),
            footerText: 'REPEATING-FOOTER',
            fontFamily: 'Arial',
            headingFontFamily: 'Arial',
          } as DocumentLayoutEntity,
          template: systemDocumentLayoutTemplates.find(
            (template) => template.type === layoutType,
          ) as unknown as DocumentLayoutTemplateEntity,
          customerName: 'Fixture customer',
        });
        const pages: Array<Array<{ str: string; y: number }>> = [];
        await pdfParse(pdf, {
          pagerender: async (page: {
            getTextContent(): Promise<{
              items: Array<{ str: string; transform: number[] }>;
            }>;
          }) => {
            const content = await page.getTextContent();
            const lines = new Map<number, string>();
            for (const item of content.items) {
              const y = Math.round(item.transform[5] * 10) / 10;
              lines.set(y, (lines.get(y) ?? '') + item.str);
            }
            pages.push(Array.from(lines, ([y, str]) => ({ str, y })));
            return content.items.map((item) => item.str).join(' ');
          },
        });
        expect(pages.length).toBeGreaterThan(1);
        for (const words of pages) {
          const header = words.find((item) =>
            item.str.includes('REPEATING-AGENCY'),
          );
          const footer = words.find((item) =>
            item.str.includes('REPEATING-FOOTER'),
          );
          expect(header).toBeDefined();
          expect(footer).toBeDefined();
          for (const item of words.filter((item) =>
            /^ITEM-\d/.test(item.str),
          )) {
            // PDF coordinates start at the lower edge of each page.
            expect(item.y).toBeLessThan(header!.y - 15);
            expect(item.y).toBeGreaterThan(footer!.y + 15);
          }
        }
        const text = pages
          .flat()
          .map((item) => item.str)
          .join(' ');
        expect(text).toContain('ITEM-60');
        expect(text.match(/ITEM-\d{2}/g)).toHaveLength(60);
        expect(text).toContain('Fixture customer');
      } finally {
        await browser.close();
      }
    },
    30000,
  );
});
