/**
 * CSV serialization for the Planner export (E6).
 *
 * ## Formula neutralization is the reason this file exists
 *
 * Excel, LibreOffice and Google Sheets all treat a cell beginning with `=`,
 * `+`, `-` or `@` as a formula. A content title such as `=cmd|'/c calc'!A1`
 * therefore executes on open — CSV injection, and the Planner is a perfect
 * carrier because every exported field is operator-supplied free text.
 *
 * The fix is a leading apostrophe, which spreadsheets consume as "treat the
 * rest as text" and which round-trips back to the original string on import.
 * Quoting alone does not help: a quoted `"=1+1"` is still parsed as a formula
 * once the quotes are stripped by the CSV reader.
 *
 * Tab and carriage return are included in the trigger set because both are
 * whitespace a spreadsheet skips before deciding whether a cell is a formula,
 * so `\t=1+1` is as dangerous as `=1+1`.
 *
 * ## Why a UTF-8 BOM
 *
 * Excel on Windows reads a BOM-less UTF-8 file as the local ANSI codepage, so
 * every accented character in Portuguese content becomes mojibake. The BOM is
 * three bytes that make the file open correctly everywhere it is likely to be
 * opened, and every CSV parser that matters strips it.
 *
 * ## Why CRLF
 *
 * RFC 4180 says CRLF, and Excel is the tool that cares. Readers that accept LF
 * accept CRLF too.
 */

const FORMULA_PREFIXES = ['=', '+', '-', '@'];

/**
 * Whitespace a spreadsheet skips before deciding a cell is a formula.
 * `\s` already covers tab, CR, LF and the Unicode spaces.
 */
const LEADING_WHITESPACE = /^\s+/;

/** U+FEFF, written as an escape so it survives any editor that trims it. */
export const CSV_BOM = '\uFEFF';

const ROW_SEPARATOR = '\r\n';

/**
 * One cell: neutralized, then quoted if the CSV grammar requires it.
 *
 * Order matters. Neutralization runs on the raw value, because deciding
 * afterwards would mean inspecting a string that already has quotes in front of
 * the character being tested.
 */
/**
 * What a cell may hold.
 *
 * Objects are deliberately not accepted. `String({})` is `[object Object]`,
 * which would export silently and look like data, so a caller with something
 * structured has to decide how it reads before it reaches this function.
 */
export type CsvValue = string | number | boolean | null | undefined;

export function toCsvCell(value: CsvValue): string {
  if (value === null || value === undefined) {
    return '';
  }

  const raw = typeof value === 'string' ? value : String(value);
  const neutralized = neutralizeFormula(raw);

  if (/[",\r\n]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }

  return neutralized;
}

function neutralizeFormula(value: string): string {
  if (value.length === 0) {
    return value;
  }

  const withoutLeadingWhitespace = value.replace(LEADING_WHITESPACE, '');

  if (withoutLeadingWhitespace.length === 0) {
    return value;
  }

  const first = withoutLeadingWhitespace[0];

  if (!FORMULA_PREFIXES.includes(first)) {
    return value;
  }

  /**
   * The apostrophe goes in front of the ORIGINAL value, keeping any leading
   * whitespace the operator typed. Trimming here would silently edit exported
   * data to make it safe, when prefixing already makes it safe.
   */
  return `'${value}`;
}

export function toCsvDocument(rows: readonly (readonly CsvValue[])[]): string {
  const body = rows
    .map((row) => row.map(toCsvCell).join(','))
    .join(ROW_SEPARATOR);

  return `${CSV_BOM}${body}${ROW_SEPARATOR}`;
}
