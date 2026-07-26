import type { EntityManager } from 'typeorm';
import { AgencyClientStatus } from '../../clients/enums/client-status.enum';
import { ContactRelationship } from '../../leadflow-agents/catalog/contact-relationship.catalog';
import {
  ContactRelationshipResolver,
  type ContactRelationshipInput,
} from './contact-relationship.resolver';

function input(
  overrides: Partial<ContactRelationshipInput> = {},
): ContactRelationshipInput {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    contactId: 'contact-1',
    isInternalUser: false,
    qualificationStatus: 'qualified',
    ...overrides,
  };
}

function managerWith(findOne: jest.Mock): EntityManager {
  return {
    getRepository: () => ({ findOne }),
  } as unknown as EntityManager;
}

describe('ContactRelationshipResolver', () => {
  const resolver = new ContactRelationshipResolver();

  it('classifies an internal user without querying clients', async () => {
    const findOne = jest.fn();
    const result = await resolver.resolve(
      managerWith(findOne),
      input({ isInternalUser: true }),
    );
    expect(result).toBe(ContactRelationship.InternalUser);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('classifies a contact linked to a live client as a customer', async () => {
    const findOne = jest.fn().mockResolvedValue({
      id: 'client-1',
      status: AgencyClientStatus.Active,
      archivedAt: null,
    });
    const result = await resolver.resolve(managerWith(findOne), input());
    expect(result).toBe(ContactRelationship.Customer);
  });

  it('does not treat an archived client as a customer', async () => {
    const findOne = jest.fn().mockResolvedValue({
      id: 'client-1',
      status: AgencyClientStatus.Archived,
      archivedAt: new Date(),
    });
    const result = await resolver.resolve(managerWith(findOne), input());
    expect(result).toBe(ContactRelationship.Lead);
  });

  it('classifies a qualified non-customer as a lead', async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const result = await resolver.resolve(managerWith(findOne), input());
    expect(result).toBe(ContactRelationship.Lead);
  });

  it('is unknown when not qualified and not a customer', async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const result = await resolver.resolve(
      managerWith(findOne),
      input({ qualificationStatus: 'non_lead' }),
    );
    expect(result).toBe(ContactRelationship.Unknown);
  });

  it('skips the client lookup when there is no contact id', async () => {
    const findOne = jest.fn();
    const result = await resolver.resolve(
      managerWith(findOne),
      input({ contactId: null }),
    );
    expect(result).toBe(ContactRelationship.Lead);
    expect(findOne).not.toHaveBeenCalled();
  });
});
