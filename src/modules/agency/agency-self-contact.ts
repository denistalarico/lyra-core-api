import { EntityManager } from 'typeorm';
import { ContactEntity } from '../contacts/entities/contact.entity';
import {
  ContactMethodEntity,
  ContactMethodType,
} from '../contacts/entities/contact-method.entity';
import { ContactAddressEntity } from '../contacts/entities/contact-address.entity';
import { AgencyContactProfileEntity } from './entities/agency-contact-details.entities';
import { AgencyWorkspaceCompanySettingsEntity } from './entities/agency-settings.entities';

/** `contacts.source` of the one contact that represents the agency itself. */
export const AGENCY_SELF_CONTACT_SOURCE = 'agency_self';

type Scope = { tenantId: string; workspaceId: string };

const digits = (value: string | null | undefined) =>
  (value ?? '').replace(/\D/g, '');

/**
 * Keeps the agency's own contact in line with /settings/company so projects
 * (and, through them, the agency's own Planner) can be linked to the agency.
 * A manual contact with the same tax id is adopted instead of duplicated.
 * `onlyIfMissing` lets hot paths create it without rewriting it every call.
 */
export async function syncAgencySelfContact(
  manager: EntityManager,
  scope: Scope,
  options: { onlyIfMissing?: boolean } = {},
): Promise<ContactEntity | null> {
  const contacts = manager.getRepository(ContactEntity);
  const where = { tenantId: scope.tenantId, workspaceId: scope.workspaceId };
  if (options.onlyIfMissing) {
    const existing = await contacts.findOne({
      where: { ...where, source: AGENCY_SELF_CONTACT_SOURCE },
    });
    if (existing) return existing;
  }

  const company = await manager
    .getRepository(AgencyWorkspaceCompanySettingsEntity)
    .findOne({ where });
  const displayName = (
    company?.tradeName ||
    company?.legalName ||
    company?.workspaceName ||
    ''
  ).trim();
  if (!company || !displayName) return null;

  return manager.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `agency_self_contact:${scope.workspaceId}`,
    ]);
    const repo = tx.getRepository(ContactEntity);
    let contact = await repo.findOne({
      where: { ...where, source: AGENCY_SELF_CONTACT_SOURCE },
    });
    if (contact && options.onlyIfMissing) return contact;

    const taxId = digits(company.taxId);
    if (!contact && taxId) {
      const candidates = await repo.find({
        where: { ...where, type: 'organization' },
        order: { createdAt: 'ASC' },
      });
      contact =
        candidates.find(
          (candidate) =>
            candidate.status !== 'archived' &&
            digits(candidate.documentNumber) === taxId,
        ) ?? null;
    }

    contact = repo.merge(contact ?? repo.create({ ...where }), {
      type: 'organization',
      displayName: displayName.slice(0, 160),
      legalName: company.legalName?.trim() || null,
      documentType: company.taxIdType?.trim() || null,
      documentNumber: company.taxId?.trim() || null,
      source: AGENCY_SELF_CONTACT_SOURCE,
      lifecycleStage: 'internal',
      lifecycleStages: [
        ...new Set([...(contact?.lifecycleStages ?? []), 'internal' as const]),
      ],
      status: 'active',
    });
    contact = await repo.save(contact);

    const methods = tx.getRepository(ContactMethodEntity);
    const current = await methods.find({
      where: { ...where, contactId: contact.id },
    });
    const wanted: [ContactMethodType, string | null][] = [
      ['email', company.supportEmail],
      ['phone', company.phone],
      ['website', company.website],
    ];
    for (const [type, raw] of wanted) {
      const value = raw?.trim();
      if (!value) continue;
      const sameType = current.filter((method) => method.type === type);
      if (sameType.some((method) => method.value.trim() === value)) continue;
      await methods.save(
        methods.create({
          ...where,
          contactId: contact.id,
          type,
          value: value.slice(0, 255),
          label: null,
          isPrimary: sameType.length === 0,
        }),
      );
    }
    await syncAddress(tx, where, contact.id, company);
    await syncAvatar(tx, where, contact.id, company);
    return contact;
  });
}

const COUNTRY_NAMES: Record<string, string> = { BR: 'Brasil' };

/** "Rua X, 1407 - Bairro" → street, number, district; otherwise all street. */
export function splitAddressLine(line: string) {
  const match = /^(.+?),\s*([^,-]+?)\s*(?:-\s*(.+))?$/.exec(line.trim());
  if (!match) return { street: line.trim(), number: null, district: null };
  return {
    street: match[1].trim(),
    number: match[2].trim() || null,
    district: match[3]?.trim() || null,
  };
}

async function syncAddress(
  tx: EntityManager,
  where: Scope,
  contactId: string,
  company: AgencyWorkspaceCompanySettingsEntity,
) {
  const line = company.addressLine?.trim();
  const metadata = (company.metadata ?? {}) as Record<string, unknown>;
  const text = (key: string) =>
    typeof metadata[key] === 'string' && (metadata[key] as string).trim()
      ? (metadata[key] as string).trim().slice(0, 120)
      : null;
  if (!line && !text('city')) return;
  const repo = tx.getRepository(ContactAddressEntity);
  const current = await repo.findOne({
    where: { ...where, contactId, type: 'main' },
    order: { createdAt: 'ASC' },
  });
  const parts = line
    ? splitAddressLine(line)
    : { street: null, number: null, district: null };
  const country = company.country?.trim() || null;
  await repo.save(
    repo.merge(current ?? repo.create({ ...where, contactId, type: 'main' }), {
      street: parts.street?.slice(0, 255) ?? null,
      number: parts.number?.slice(0, 30) ?? null,
      district: parts.district?.slice(0, 120) ?? null,
      city: text('city'),
      state: text('state'),
      country: country ? (COUNTRY_NAMES[country] ?? country) : null,
    }),
  );
}

/** The company's square mark (avatar), else its logo. Never clears one. */
async function syncAvatar(
  tx: EntityManager,
  where: Scope,
  contactId: string,
  company: AgencyWorkspaceCompanySettingsEntity,
) {
  const url = company.avatarUrl?.trim() || company.logoUrl?.trim();
  if (!url) return;
  const key = company.avatarUrl?.trim()
    ? company.avatarPath
    : company.logoPath;
  const repo = tx.getRepository(AgencyContactProfileEntity);
  const profile = await repo.findOne({ where: { ...where, contactId } });
  if (profile?.avatarUrl === url) return;
  await repo.save(
    repo.merge(profile ?? repo.create({ ...where, contactId }), {
      avatarUrl: url,
      avatarObjectKey: key ?? null,
    }),
  );
}

/** True when `contactId` is the agency's own contact in this workspace. */
export async function isAgencySelfContact(
  manager: EntityManager,
  scope: Scope,
  contactId: string,
): Promise<boolean> {
  return manager.getRepository(ContactEntity).exists({
    where: {
      id: contactId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      source: AGENCY_SELF_CONTACT_SOURCE,
    },
  });
}
