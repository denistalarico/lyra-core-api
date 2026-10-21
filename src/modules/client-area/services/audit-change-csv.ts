import { PayloadTooLargeException } from '@nestjs/common';
import type { AuditChangeService } from './audit-change.service';

/** Quotes every cell and neutralizes spreadsheet formula prefixes. */
export function auditCsvCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean' ||
            typeof value === 'bigint'
          ? String(value)
          : '';
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function exportAuditChangesCsv(
  audit: AuditChangeService,
  scope: Parameters<AuditChangeService['list']>[0],
  filters: Parameters<AuditChangeService['list']>[1],
  clientVisibleOnly = false,
) {
  const columns = [
    'id',
    'companyContextId',
    'actorUserId',
    'actorSurface',
    'moduleKey',
    'entityType',
    'entityId',
    'action',
    'changedFields',
    'diff',
    'occurredAt',
  ] as const;
  const lines = [columns.map(auditCsvCell).join(',')];
  for (let page = 1; ; page++) {
    const result = await audit.list(
      scope,
      { ...filters, page, limit: 100 },
      clientVisibleOnly,
    );
    if (result.total > 10000)
      throw new PayloadTooLargeException(
        'Narrow the period to export at most 10000 events.',
      );
    for (const event of result.events)
      lines.push(columns.map((key) => auditCsvCell(event[key])).join(','));
    if (page * 100 >= result.total) break;
  }
  return '\ufeff' + lines.join('\r\n');
}
