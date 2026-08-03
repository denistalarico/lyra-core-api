const pdfParseMock = jest.fn();
jest.mock('pdf-parse', () => (...args: unknown[]) => pdfParseMock(...args));

import { extractPdfText } from './leadflow-briefing-pdf-text.util';

describe('extractPdfText', () => {
  afterEach(() => jest.clearAllMocks());

  it('passes maxPages through to pdf-parse and returns the extracted text', async () => {
    pdfParseMock.mockResolvedValue({ text: 'Hello PDF' });
    const buffer = Buffer.from('%PDF-1.4 fake');

    const text = await extractPdfText(buffer, { maxPages: 30, maxChars: 1000 });

    expect(text).toBe('Hello PDF');
    expect(pdfParseMock).toHaveBeenCalledWith(buffer, { max: 30 });
  });

  it('truncates extracted text at maxChars', async () => {
    pdfParseMock.mockResolvedValue({ text: 'a'.repeat(100) });

    const text = await extractPdfText(Buffer.from('x'), { maxPages: 30, maxChars: 10 });

    expect(text).toHaveLength(10);
  });

  it('treats a missing text field as empty rather than throwing', async () => {
    pdfParseMock.mockResolvedValue({});

    const text = await extractPdfText(Buffer.from('x'), { maxPages: 30, maxChars: 10 });

    expect(text).toBe('');
  });

  it('normalizes any parse failure to a safe, non-echoing code', async () => {
    pdfParseMock.mockRejectedValue(new Error('some internal pdfjs stack trace with sensitive doc content'));

    await expect(
      extractPdfText(Buffer.from('x'), { maxPages: 30, maxChars: 10 }),
    ).rejects.toMatchObject({ code: 'pdf_parse_failed' });
  });
});
