import {
  CLIENT_NOTIFICATION_CATALOG,
  clientNotificationDefinitionForEvent,
} from './client-notification-catalog';

describe('R3 client notification catalog', () => {
  it('catalogs every client-facing notification type and its channels', () => {
    expect(Object.keys(CLIENT_NOTIFICATION_CATALOG)).toEqual([
      'approval.pending',
      'approval.reminder',
      'conversation.message',
      'invoice.due_soon',
      'invoice.overdue',
      'contract.signature_pending',
      'deliverable.published',
    ]);

    for (const definition of Object.values(CLIENT_NOTIFICATION_CATALOG)) {
      expect(definition.channels).toEqual([
        'in_app',
        'push',
        'email',
        'whatsapp',
      ]);
      expect(definition.requiredPermission).toMatch(/^client_area\./);
      expect(definition.requiredModule).toBeTruthy();
    }
  });

  it('maps the existing domain event names to the single client catalog', () => {
    expect(
      clientNotificationDefinitionForEvent('finance.invoice_due_soon')?.type,
    ).toBe('invoice.due_soon');
    expect(
      clientNotificationDefinitionForEvent('finance.invoice_overdue')?.type,
    ).toBe('invoice.overdue');
    expect(
      clientNotificationDefinitionForEvent('contract.signature_reminder_due')
        ?.type,
    ).toBe('contract.signature_pending');
    expect(
      clientNotificationDefinitionForEvent('social.approval.awaiting_client')
        ?.type,
    ).toBe('approval.pending');
  });
});
