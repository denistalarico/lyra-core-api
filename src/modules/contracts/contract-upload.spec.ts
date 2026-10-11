import { decodeContractUpload } from './contract-upload';
import { ContractAttachmentKind } from './enums';
const formats = [
  ['application/pdf', Buffer.from('%PDF-1.7'), 'pdf'],
  ['image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'png'],
  ['image/jpeg', Buffer.from([255, 216, 255]), 'jpg'],
  ['image/webp', Buffer.from('RIFF1234WEBP'), 'webp'],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    Buffer.from([80, 75, 3, 4]),
    'docx',
  ],
  [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    Buffer.from([80, 75, 3, 4]),
    'xlsx',
  ],
] as const;
describe('contract uploads', () => {
  it.each(formats)(
    'accepts byte-verified %s supporting attachments',
    (mimeType, buffer, extension) =>
      expect(
        decodeContractUpload(
          { mimeType, fileBase64: buffer.toString('base64') },
          false,
          ContractAttachmentKind.Quote,
        ),
      ).toMatchObject({ mimeType, extension }),
  );
  it.each(formats)('rejects mismatched bytes for %s', (mimeType) =>
    expect(() =>
      decodeContractUpload(
        { mimeType, fileBase64: Buffer.from('bad').toString('base64') },
        false,
        ContractAttachmentKind.Other,
      ),
    ).toThrow(),
  );
  it.each(formats.filter(([mime]) => mime !== 'application/pdf'))(
    'principal contract attachment rejects %s',
    (mimeType, buffer) =>
      expect(() =>
        decodeContractUpload(
          { mimeType, fileBase64: buffer.toString('base64') },
          false,
        ),
      ).toThrow(),
  );
  it('signed uploads accept legacy DOC and reject spreadsheets', () => {
    expect(
      decodeContractUpload(
        {
          mimeType: 'application/msword',
          fileBase64: Buffer.from([208, 207, 17, 224]).toString('base64'),
        },
        true,
      ).extension,
    ).toBe('doc');
    expect(() =>
      decodeContractUpload(
        {
          mimeType: formats[5][0],
          fileBase64: formats[5][1].toString('base64'),
        },
        true,
      ),
    ).toThrow();
  });
  it('rejects empty, malformed and over 7MB decoded payloads before storage', () => {
    for (const fileBase64 of [
      '',
      '@@@@',
      Buffer.concat([
        Buffer.from('%PDF'),
        Buffer.alloc(7 * 1024 * 1024),
      ]).toString('base64'),
    ])
      expect(() => decodeContractUpload({ fileBase64 }, true)).toThrow();
  });
  it('supports data URLs', () =>
    expect(
      decodeContractUpload(
        {
          fileBase64:
            'data:application/pdf;base64,' +
            Buffer.from('%PDF').toString('base64'),
        },
        true,
      ).buffer.toString(),
    ).toBe('%PDF'));
});
