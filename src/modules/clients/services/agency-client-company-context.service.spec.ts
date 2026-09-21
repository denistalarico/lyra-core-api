import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { ContactCompanyLinkEntity } from '../../contacts/entities/contact-company-link.entity';
import { ContactEntity } from '../../contacts/entities/contact.entity';
import { AgencyClient, AgencyClientCompanyContext } from '../entities';
import { AgencyClientCompanyContextService } from './agency-client-company-context.service';

const tenantId = '10000000-0000-4000-8000-000000000001';
const workspaceId = '20000000-0000-4000-8000-000000000001';
const clientId = '30000000-0000-4000-8000-000000000001';
const companyAId = '40000000-0000-4000-8000-000000000001';
const companyBId = '40000000-0000-4000-8000-000000000002';
const personId = '50000000-0000-4000-8000-000000000001';
const ctx = {
  tenantId,
  workspaceId,
  userId: '60000000-0000-4000-8000-000000000001',
};

describe('AgencyClientCompanyContextService', () => {
  it('makes the first active company primary and leaves the second secondary', async () => {
    const fixture = makeFixture();

    const first = await fixture.service.create(ctx, clientId, {
      companyContactId: companyAId,
    });
    const second = await fixture.service.create(ctx, clientId, {
      companyContactId: companyBId,
    });

    expect(first.isPrimary).toBe(true);
    expect(second.isPrimary).toBe(false);
    expect(fixture.contexts.filter((entry) => entry.isPrimary)).toHaveLength(1);
  });

  it('switches primary atomically', async () => {
    const fixture = makeFixture();
    const first = await fixture.service.create(ctx, clientId, {
      companyContactId: companyAId,
    });
    const second = await fixture.service.create(ctx, clientId, {
      companyContactId: companyBId,
    });

    await fixture.service.makePrimary(ctx, clientId, second.id);

    expect(
      fixture.contexts.find((entry) => entry.id === first.id)?.isPrimary,
    ).toBe(false);
    expect(
      fixture.contexts.find((entry) => entry.id === second.id)?.isPrimary,
    ).toBe(true);
  });

  it('rejects a duplicate client/company pair', async () => {
    const fixture = makeFixture();
    await fixture.service.create(ctx, clientId, {
      companyContactId: companyAId,
    });

    await expect(
      fixture.service.create(ctx, clientId, { companyContactId: companyAId }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('promotes another active company when the primary is archived', async () => {
    const fixture = makeFixture();
    const first = await fixture.service.create(ctx, clientId, {
      companyContactId: companyAId,
    });
    const second = await fixture.service.create(ctx, clientId, {
      companyContactId: companyBId,
    });

    await fixture.service.archive(ctx, clientId, first.id);

    expect(
      fixture.contexts.find((entry) => entry.id === first.id),
    ).toMatchObject({
      status: 'archived',
      isPrimary: false,
    });
    expect(
      fixture.contexts.find((entry) => entry.id === second.id)?.isPrimary,
    ).toBe(true);
  });

  it('allows archiving the last company without creating a legacy requirement', async () => {
    const fixture = makeFixture();
    const first = await fixture.service.create(ctx, clientId, {
      companyContactId: companyAId,
    });

    await fixture.service.archive(ctx, clientId, first.id);

    expect(
      fixture.contexts.filter((entry) => entry.status === 'active'),
    ).toHaveLength(0);
  });

  it('rejects a person as company context', async () => {
    const fixture = makeFixture();
    await expect(
      fixture.service.create(ctx, clientId, { companyContactId: personId }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['tenant', { ...ctx, tenantId: '10000000-0000-4000-8000-000000000099' }],
    [
      'workspace',
      { ...ctx, workspaceId: '20000000-0000-4000-8000-000000000099' },
    ],
  ])('rejects a cross-%s client scope', async (_label, foreignContext) => {
    const fixture = makeFixture();
    await expect(
      fixture.service.create(foreignContext, clientId, {
        companyContactId: companyAId,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a company contact from another workspace', async () => {
    const fixture = makeFixture();
    fixture.contacts.find((contact) => contact.id === companyAId)!.workspaceId =
      '20000000-0000-4000-8000-000000000099';

    await expect(
      fixture.service.create(ctx, clientId, { companyContactId: companyAId }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a missing client', async () => {
    const fixture = makeFixture();
    await expect(
      fixture.service.create(ctx, '30000000-0000-4000-8000-000000000099', {
        companyContactId: companyAId,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a missing organization', async () => {
    const fixture = makeFixture();
    await expect(
      fixture.service.create(ctx, clientId, {
        companyContactId: '40000000-0000-4000-8000-000000000099',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

function makeFixture() {
  const clients = [
    {
      id: clientId,
      tenantId,
      workspaceId,
      status: 'active',
      archivedAt: null,
    } as AgencyClient,
  ];
  const contacts = [
    makeContact(companyAId, 'organization', 'Empresa A'),
    makeContact(companyBId, 'organization', 'Empresa B'),
    makeContact(personId, 'person', 'Pessoa'),
  ];
  const contexts: AgencyClientCompanyContext[] = [];

  const clientsRepository = {
    findOne: jest.fn(
      async ({ where }: { where: Partial<AgencyClient> }) =>
        clients.find(
          (client) =>
            client.id === where.id &&
            client.tenantId === where.tenantId &&
            client.workspaceId === where.workspaceId,
        ) ?? null,
    ),
  } as unknown as Repository<AgencyClient>;
  const contactsRepository = {
    findOne: jest.fn(
      async ({ where }: { where: Partial<ContactEntity> }) =>
        contacts.find(
          (contact) =>
            contact.id === where.id &&
            contact.tenantId === where.tenantId &&
            contact.workspaceId === where.workspaceId,
        ) ?? null,
    ),
  } as unknown as Repository<ContactEntity>;
  const contextsRepository = {
    findOne: jest.fn(
      async ({ where }: { where: Partial<AgencyClientCompanyContext> }) =>
        contexts.find(
          (entry) =>
            (where.id === undefined || entry.id === where.id) &&
            (where.agencyClientId === undefined ||
              entry.agencyClientId === where.agencyClientId) &&
            (where.companyContactId === undefined ||
              entry.companyContactId === where.companyContactId) &&
            (where.tenantId === undefined ||
              entry.tenantId === where.tenantId) &&
            (where.workspaceId === undefined ||
              entry.workspaceId === where.workspaceId),
        ) ?? null,
    ),
    find: jest.fn(
      async ({ where }: { where: Partial<AgencyClientCompanyContext> }) =>
        contexts
          .filter(
            (entry) =>
              entry.tenantId === where.tenantId &&
              entry.workspaceId === where.workspaceId &&
              entry.agencyClientId === where.agencyClientId &&
              entry.status === 'active' &&
              entry.archivedAt === null,
          )
          .sort(
            (left, right) => Number(right.isPrimary) - Number(left.isPrimary),
          ),
    ),
    count: jest.fn(
      async () =>
        contexts.filter(
          (entry) => entry.status === 'active' && !entry.archivedAt,
        ).length,
    ),
    create: jest.fn((value: Partial<AgencyClientCompanyContext>) => ({
      id: `context-${contexts.length + 1}`,
      createdAt: new Date(contexts.length + 1),
      updatedAt: new Date(contexts.length + 1),
      ...value,
    })),
    save: jest.fn(async (value: AgencyClientCompanyContext) => {
      const index = contexts.findIndex((entry) => entry.id === value.id);
      if (index >= 0) contexts[index] = value;
      else contexts.push(value);
      return value;
    }),
    update: jest.fn(
      async (_where: unknown, patch: Partial<AgencyClientCompanyContext>) => {
        contexts
          .filter((entry) => entry.status === 'active' && !entry.archivedAt)
          .forEach((entry) => Object.assign(entry, patch));
        return { affected: contexts.length };
      },
    ),
  } as unknown as Repository<AgencyClientCompanyContext>;
  const manager = {
    getRepository(entity: unknown) {
      if (entity === AgencyClient) return clientsRepository;
      if (entity === ContactEntity) return contactsRepository;
      if (entity === AgencyClientCompanyContext) return contextsRepository;
      throw new Error('Unexpected repository');
    },
  };
  const dataSource = {
    transaction: jest.fn(async (callback: (value: typeof manager) => unknown) =>
      callback(manager),
    ),
  } as unknown as DataSource;
  const service = new AgencyClientCompanyContextService(
    dataSource,
    clientsRepository,
    contextsRepository,
    contactsRepository,
    {} as Repository<ContactCompanyLinkEntity>,
  );

  return { service, contexts, contacts };
}

function makeContact(
  id: string,
  type: ContactEntity['type'],
  displayName: string,
) {
  return {
    id,
    tenantId,
    workspaceId,
    type,
    displayName,
    legalName: null,
    documentType: null,
    documentNumber: null,
    status: 'active',
  } as ContactEntity;
}
