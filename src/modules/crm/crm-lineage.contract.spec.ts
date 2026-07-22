import 'reflect-metadata';
import { PERMISSION_KEY_METADATA } from '../permissions';
import { CrmController } from './crm.controller';

describe('CRM opportunity lineage HTTP contract', () => {
  it.each(['copyOpportunity', 'reconvertOpportunity'] as const)(
    'requires CRM create permission for %s',
    (method) => {
      expect(
        Reflect.getMetadata(
          PERMISSION_KEY_METADATA,
          CrmController.prototype[method],
        ),
      ).toBe('leadflow.crm.records.create.client');
    },
  );
});
