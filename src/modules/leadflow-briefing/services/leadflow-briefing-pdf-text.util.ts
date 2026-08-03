import pdfParse from 'pdf-parse';
import { LeadFlowBriefingExtractionError } from './leadflow-briefing-extraction.errors';

/**
 * Extracts text from an already-safe (magic-byte-validated, size-capped at
 * ingestion by F4-002) PDF buffer. Bounded defensively on top of that: a
 * degenerate/huge PDF still can't blow up prompt size or cost, and any parse
 * failure is normalized (never echoes the parser's raw exception message).
 */
export async function extractPdfText(
  buffer: Buffer,
  opts: { maxPages: number; maxChars: number },
): Promise<string> {
  let text: string;
  try {
    const result = await pdfParse(buffer, { max: opts.maxPages });
    text = result.text ?? '';
  } catch {
    throw new LeadFlowBriefingExtractionError('pdf_parse_failed');
  }
  return text.length > opts.maxChars ? text.slice(0, opts.maxChars) : text;
}
