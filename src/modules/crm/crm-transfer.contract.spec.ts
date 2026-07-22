import 'reflect-metadata';
import { ANY_PERMISSION_KEYS_METADATA } from '../permissions';
import { CrmController } from './crm.controller';

describe('CRM opportunity transfer contract', () => {
  it('requires an assigned-scope or client-scope CRM update permission', () => {
    const permissions = Reflect.getMetadata(
      ANY_PERMISSION_KEYS_METADATA,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CrmController.prototype.transferOpportunity,
    ) as unknown;

    expect(permissions).toEqual([
      'leadflow.crm.records.update.assigned',
      'leadflow.crm.records.update.client',
    ]);
  });
});
