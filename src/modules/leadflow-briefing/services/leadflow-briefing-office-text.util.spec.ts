import { BadRequestException } from '@nestjs/common';
import {
  assertBriefingOfficeSignature,
  getBriefingOfficeKind,
} from './leadflow-briefing-office-text.util';

describe('LeadFlow briefing Office files', () => {
  it.each([
    ['briefing.doc', 'doc'],
    ['briefing.DOCX', 'docx'],
    ['deck.pptx', 'pptx'],
    ['briefing.pdf', null],
  ])('resolves the supported kind for %s', (filename, expected) => {
    expect(getBriefingOfficeKind(filename)).toBe(expected);
  });

  it('accepts the ZIP signature used by DOCX/PPTX', () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    expect(() => assertBriefingOfficeSignature(zip, 'docx')).not.toThrow();
    expect(() => assertBriefingOfficeSignature(zip, 'pptx')).not.toThrow();
  });

  it('accepts the OLE compound-document signature used by legacy DOC', () => {
    const ole = Buffer.from('d0cf11e0a1b11ae1', 'hex');
    expect(() => assertBriefingOfficeSignature(ole, 'doc')).not.toThrow();
  });

  it('rejects an extension spoof whose bytes do not match the container', () => {
    expect(() =>
      assertBriefingOfficeSignature(Buffer.from('not-an-office-file'), 'docx'),
    ).toThrow(BadRequestException);
  });
});
