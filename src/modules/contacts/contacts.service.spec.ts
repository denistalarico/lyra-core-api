import { Repository } from 'typeorm';
import { RequestContext } from '../../common/context/request-context.interface';
import { ContactBusinessModeEntity } from './entities/contact-business-mode.entity';
import { ContactCustomFieldValueEntity } from './entities/contact-custom-field-value.entity';
import { ContactCustomFieldEntity } from './entities/contact-custom-field.entity';
import { ContactSegmentEntity } from './entities/contact-segment.entity';
import { ContactViewPreferenceEntity } from './entities/contact-view-preference.entity';
import { ContactAddressEntity } from './entities/contact-address.entity';
import { ContactListMemberEntity } from './entities/contact-list-member.entity';
import { ContactListEntity } from './entities/contact-list.entity';
import { ContactMethodEntity } from './entities/contact-method.entity';
import { ContactTagAssignmentEntity } from './entities/contact-tag-assignment.entity';
import { ContactTagEntity } from './entities/contact-tag.entity';
import { ContactEntity } from './entities/contact.entity';
import { ContactsService } from './contacts.service';

describe('ContactsService collection scoping', () => {
  it('scopes member contact lists to owned or created contacts', async () => {
    const { service, queryBuilder } = makeService();

    await service.listContacts(makeContext({ role: 'member' }));

    const clauses = queryBuilder.scopeClauses.join('\n');
    expect(clauses).toContain('contact.ownerUserId = :scopeUserId');
    expect(clauses).toContain('contact.createdByUserId = :scopeUserId');
  });
});

function makeService() {
  const queryBuilder = createQueryBuilderMock<ContactEntity>();
  const contactsRepository = {
    createQueryBuilder: jest.fn(() => queryBuilder),
  };
  const readRepository = {
    find: jest.fn().mockResolvedValue([]),
  };
  const service = new ContactsService(
    contactsRepository as unknown as Repository<ContactEntity>,
    readRepository as unknown as Repository<ContactMethodEntity>,
    readRepository as unknown as Repository<ContactAddressEntity>,
    readRepository as unknown as Repository<ContactListEntity>,
    readRepository as unknown as Repository<ContactListMemberEntity>,
    readRepository as unknown as Repository<ContactTagEntity>,
    readRepository as unknown as Repository<ContactTagAssignmentEntity>,
    readRepository as unknown as Repository<ContactCustomFieldEntity>,
    readRepository as unknown as Repository<ContactCustomFieldValueEntity>,
    readRepository as unknown as Repository<ContactSegmentEntity>,
    readRepository as unknown as Repository<ContactBusinessModeEntity>,
    readRepository as unknown as Repository<ContactViewPreferenceEntity>,
  );

  return { service, queryBuilder };
}

function createQueryBuilderMock<T>() {
  const scopeClauses: string[] = [];
  const bracketQb = {
    where: jest.fn((condition: string) => {
      scopeClauses.push(condition);
      return bracketQb;
    }),
    orWhere: jest.fn((condition: string) => {
      scopeClauses.push(condition);
      return bracketQb;
    }),
  };
  const qb = {
    scopeClauses,
    where: jest.fn(() => qb),
    andWhere: jest.fn((condition: unknown) => {
      if (
        condition &&
        typeof condition === 'object' &&
        'whereFactory' in condition &&
        typeof (condition as { whereFactory?: unknown }).whereFactory ===
          'function'
      ) {
        (condition as { whereFactory: (qb: typeof bracketQb) => void })
          .whereFactory(bracketQb);
      } else if (typeof condition === 'string') {
        scopeClauses.push(condition);
      }
      return qb;
    }),
    innerJoin: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    take: jest.fn(() => qb),
    skip: jest.fn(() => qb),
    getManyAndCount: jest.fn().mockResolvedValue([[] as T[], 0]),
  };

  return qb;
}

function makeContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    ...overrides,
  };
}
