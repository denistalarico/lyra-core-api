import { CSV_BOM, toCsvCell, toCsvDocument } from './social-content-csv';

describe('social content CSV', () => {
  describe('formula neutralization', () => {
    /**
     * The four characters a spreadsheet reads as "this cell is a formula".
     * Each one is a working CSV injection if it reaches the file unprefixed.
     */
    it.each([
      ['=1+1', "'=1+1"],
      ['+1', "'+1"],
      ['-1', "'-1"],
      ['@SUM(A1)', "'@SUM(A1)"],
    ])('prefixes %s', (input, expected) => {
      expect(toCsvCell(input)).toBe(expected);
    });

    /** The classic command-execution payload. */
    it('neutralizes a command-execution payload', () => {
      expect(toCsvCell(`=cmd|'/c calc'!A1`)).toBe(`'=cmd|'/c calc'!A1`);
    });

    /**
     * Neutralization and quoting are independent rules, and a payload that
     * also contains a comma has to get both.
     */
    it('neutralizes and quotes a payload containing a comma', () => {
      expect(toCsvCell('=HYPERLINK("http://x","click")')).toBe(
        `"'=HYPERLINK(""http://x"",""click"")"`,
      );
    });

    /**
     * A spreadsheet skips leading whitespace before deciding, so a payload can
     * hide behind a tab or a space and still execute.
     */
    it.each(['\t=1+1', ' =1+1', '\n=1+1'])(
      'neutralizes a payload hidden behind whitespace: %j',
      (input) => {
        const cell = toCsvCell(input);
        const unquoted = cell.startsWith('"')
          ? cell.slice(1, -1).replace(/""/g, '"')
          : cell;

        expect(unquoted.startsWith("'")).toBe(true);
      },
    );

    /** Quoting alone is not protection: readers strip quotes, then evaluate. */
    it('does not rely on quoting to make a formula safe', () => {
      expect(toCsvCell('=1+1')).not.toBe('"=1+1"');
    });

    it('leaves ordinary text alone', () => {
      expect(toCsvCell('Lançamento de outubro')).toBe('Lançamento de outubro');
      expect(toCsvCell('2026-10-01')).toBe('2026-10-01');
    });

    /**
     * A negative number is indistinguishable from a `-` formula to a
     * spreadsheet, so it is prefixed too. Reading it back as text is the
     * correct trade: silently executing it is not, and the export is a report
     * rather than a data-interchange format.
     */
    it('prefixes a negative number, accepting it becomes text', () => {
      expect(toCsvCell('-42')).toBe("'-42");
    });
  });

  describe('CSV grammar', () => {
    it('quotes and doubles embedded quotes', () => {
      expect(toCsvCell('diz "olá"')).toBe('"diz ""olá"""');
    });

    it('quotes a value containing a comma', () => {
      expect(toCsvCell('a, b')).toBe('"a, b"');
    });

    it('quotes a value containing a newline', () => {
      expect(toCsvCell('linha 1\nlinha 2')).toBe('"linha 1\nlinha 2"');
    });

    it('renders null and undefined as empty, not as text', () => {
      expect(toCsvCell(null)).toBe('');
      expect(toCsvCell(undefined)).toBe('');
      expect(toCsvCell('')).toBe('');
    });
  });

  describe('document', () => {
    it('starts with a UTF-8 BOM so Excel reads accents correctly', () => {
      expect(toCsvDocument([['Título']]).startsWith(CSV_BOM)).toBe(true);
    });

    it('separates rows with CRLF', () => {
      const document = toCsvDocument([['a'], ['b']]);

      expect(document).toBe(`${CSV_BOM}a\r\nb\r\n`);
    });

    it('keeps a header-only export valid', () => {
      expect(toCsvDocument([['Título', 'Data']])).toBe(
        `${CSV_BOM}Título,Data\r\n`,
      );
    });
  });
});
