import { EntityManager } from 'typeorm';
import { ContactEntity } from '../contacts/entities/contact.entity';
import {
  ContactMethodEntity,
  ContactMethodType,
} from '../contacts/entities/contact-method.entity';
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
    return contact;
  });
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
