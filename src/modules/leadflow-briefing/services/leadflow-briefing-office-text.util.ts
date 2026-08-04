import { BadRequestException } from '@nestjs/common';
import { OfficeParser } from 'officeparser';
import WordExtractor from 'word-extractor';

export type BriefingOfficeKind = 'doc' | 'docx' | 'pptx';

export const BRIEFING_OFFICE_MIME: Record<BriefingOfficeKind, string> = {
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const ZIP_SIGNATURES = new Set(['504b0304', '504b0506', '504b0708']);
const OLE_SIGNATURE = 'd0cf11e0a1b11ae1';

export function getBriefingOfficeKind(
  filename: string,
): BriefingOfficeKind | null {
  const extension = filename.split('.').pop()?.toLowerCase();
  return extension === 'doc' || extension === 'docx' || extension === 'pptx'
    ? extension
    : null;
}

/**
 * Cheap signature gate before the malware scanner/parser. OOXML is ZIP-based;
 * legacy DOC uses the OLE compound-document signature.
 */
export function assertBriefingOfficeSignature(
  buffer: Buffer,
  kind: BriefingOfficeKind,
): void {
  const valid =
    kind === 'doc'
      ? buffer.subarray(0, 8).toString('hex') === OLE_SIGNATURE
      : ZIP_SIGNATURES.has(buffer.subarray(0, 4).toString('hex'));

  if (!valid) {
    throw new BadRequestException('Unsupported or unrecognized Office file.');
  }
}

export async function extractBriefingOfficeText(
  buffer: Buffer,
  kind: BriefingOfficeKind,
  maxChars: number,
): Promise<string> {
  try {
    if (kind === 'doc') {
      const document = await new WordExtractor().extract(buffer);
      return document.getBody().slice(0, maxChars);
    }

    const ast = await OfficeParser.parseOffice(buffer, {
      fileType: kind,
      extractAttachments: false,
      ignoreComments: true,
      ignoreSlideMasters: true,
    });
    if (ast.type !== kind) {
      throw new Error(`Expected ${kind}, received ${ast.type}.`);
    }
    const result = await ast.to('text', {
      includeImages: false,
      textConfig: { preserveLayout: false, renderNotes: true },
    });
    return String(result.value).slice(0, maxChars);
  } catch {
    throw new BadRequestException(
      'O arquivo Office está corrompido ou não pôde ser lido.',
    );
  }
}
