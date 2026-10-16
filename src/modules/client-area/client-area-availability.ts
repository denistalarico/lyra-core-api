import type { AgencyClient } from '../clients/entities/agency-client.entity';
import type { AgencyClientCompanyContext } from '../clients/entities/agency-client-company-context.entity';
import { AgencyClientStatus } from '../clients/enums';
import type { ContactEntity } from '../contacts/entities/contact.entity';

/** CA1 predicates, extracted without changing the authorization contract. */
export function isActiveClient(
  client: AgencyClient | null | undefined,
): client is AgencyClient {
  return (
    !!client &&
    client.status === AgencyClientStatus.Active &&
    !client.archivedAt
  );
}
export function isActiveCompany(
  company: AgencyClientCompanyContext | null | undefined,
): company is AgencyClientCompanyContext {
  return !!company && company.status === 'active' && !company.archivedAt;
}
export function isAvailableOrganization(
  contact: ContactEntity | null | undefined,
): contact is ContactEntity {
  return (
    !!contact &&
    contact.type === 'organization' &&
    contact.status !== 'archived'
  );
}
