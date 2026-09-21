import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';
import { ContactCompanyLinkEntity } from '../contacts/entities/contact-company-link.entity';
import { ContactEntity } from '../contacts/entities/contact.entity';
import { AgencyContactsService } from './agency-contacts.service';

const tenantId = '11000000-0000-4000-8000-000000000001';
const workspaceId = '22000000-0000-4000-8000-000000000001';
const ctx = {
  tenantId,
  workspaceId,
  userId: '33000000-0000-4000-8000-000000000001',
};

describe('AgencyContactsService person/company links', () => {
  it('supports N companies per person and N people per company', async () => {
    const fixture = makeFixture();

    await fixture.service.addCompanyLink(ctx, 'person-a', 'company-a');
    await fixture.service.addCompanyLink(ctx, 'person-a', 'company-b');
    await fixture.service.addCompanyLink(ctx, 'person-b', 'company-a');

    expect(fixture.links).toHaveLength(3);
    expect(
      fixture.links.filter((link) => link.personContactId === 'person-a'),
    ).toHaveLength(2);
    expect(
      fixture.links.filter((link) => link.companyContactId === 'company-a'),
    ).toHaveLength(2);
  });

  it('rejects a duplicate pair', async () => {
    const fixture = makeFixture();
    await fixture.service.addCompanyLink(ctx, 'person-a', 'company-a');

    await expect(
      fixture.service.addCompanyLink(ctx, 'person-a', 'company-a'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects person-to-person and organization-to-organization pairs', async () => {
    const fixture = makeFixture();

    await expect(
      fixture.service.addCompanyLink(ctx, 'person-a', 'person-b'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      fixture.service.addCompanyLink(ctx, 'company-a', 'company-b'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects cross-workspace contacts', async () => {
    const fixture = makeFixture();

    await expect(
      fixture.service.addCompanyLink(ctx, 'person-a', 'foreign-company'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps exactly one active primary and promotes after removal', async () => {
    const fixture = makeFixture();
    await fixture.service.addCompanyLink(ctx, 'person-a', 'company-a');
    await fixture.service.addCompanyLink(ctx, 'person-a', 'company-b', {
      isPrimary: true,
    });

    expect(
      fixture.links.find((link) => link.companyContactId === 'company-b')
        ?.isPrimary,
    ).toBe(true);

    await fixture.service.removeCompanyLink(ctx, 'person-a', 'company-b');

    expect(fixture.links).toHaveLength(1);
    expect(fixture.links[0]).toMatchObject({
      companyContactId: 'company-a',
      isPrimary: true,
    });
  });
});

function makeFixture() {
  const contacts = [
    makeContact('person-a', 'person'),
    makeContact('person-b', 'person'),
    makeContact('company-a', 'organization'),
    makeContact('company-b', 'organization'),
    {
      ...makeContact('foreign-company', 'organization'),
      workspaceId: '22000000-0000-4000-8000-000000000099',
    },
  ];
  const links: ContactCompanyLinkEntity[] = [];
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
    update: jest.fn(async () => ({ affected: 1 })),
  } as unknown as Repository<ContactEntity>;
  const linksRepository = {
    findOne: jest.fn(
      async ({ where }: { where: Partial<ContactCompanyLinkEntity> }) =>
        links.find(
          (link) =>
            link.tenantId === where.tenantId &&
            link.workspaceId === where.workspaceId &&
            link.personContactId === where.personContactId &&
            link.companyContactId === where.companyContactId,
        ) ?? null,
    ),
    find: jest.fn(
      async ({ where }: { where: Partial<ContactCompanyLinkEntity> }) =>
        links
          .filter(
            (link) =>
              link.tenantId === where.tenantId &&
              link.workspaceId === where.workspaceId &&
              link.personContactId === where.personContactId &&
              (where.status === undefined || link.status === where.status),
          )
          .sort(
            (left, right) => Number(right.isPrimary) - Number(left.isPrimary),
          ),
    ),
    create: jest.fn((value: Partial<ContactCompanyLinkEntity>) => ({
      id: `link-${links.length + 1}`,
      createdAt: new Date(links.length + 1),
      updatedAt: new Date(links.length + 1),
      ...value,
    })),
    save: jest.fn(async (value: ContactCompanyLinkEntity) => {
      const index = links.findIndex((link) => link.id === value.id);
      if (index >= 0) links[index] = value;
      else links.push(value);
      return value;
    }),
    update: jest.fn(
      async (
        where: Partial<ContactCompanyLinkEntity>,
        patch: Partial<ContactCompanyLinkEntity>,
      ) => {
        links
          .filter(
            (link) =>
              link.tenantId === where.tenantId &&
              link.workspaceId === where.workspaceId &&
              link.personContactId === where.personContactId &&
              (where.isPrimary === undefined ||
                link.isPrimary === where.isPrimary),
          )
          .forEach((link) => Object.assign(link, patch));
        return { affected: links.length };
      },
    ),
    delete: jest.fn(async (where: Partial<ContactCompanyLinkEntity>) => {
      const index = links.findIndex(
        (link) =>
          link.tenantId === where.tenantId &&
          link.workspaceId === where.workspaceId &&
          link.personContactId === where.personContactId &&
          link.companyContactId === where.companyContactId,
      );
      if (index >= 0) links.splice(index, 1);
      return { affected: index >= 0 ? 1 : 0 };
    }),
  } as unknown as Repository<ContactCompanyLinkEntity>;

  const service = new AgencyContactsService(
    {} as never,
    contactsRepository,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    linksRepository,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, links };
}

function makeContact(id: string, type: ContactEntity['type']) {
  return {
    id,
    tenantId,
    workspaceId,
    type,
    displayName: id,
    status: 'active',
  } as ContactEntity;
}
