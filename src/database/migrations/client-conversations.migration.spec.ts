import { agencyEntities } from '../../config/typeorm.config';
import {
  ClientConversationAttachmentEntity,
  ClientConversationEntity,
  ClientConversationMessageEntity,
  ClientConversationParticipantEntity,
} from '../../modules/client-conversations/entities';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateClientConversations1797500000000 } from './1797500000000-create-client-conversations';

/**
 * The registration checks a migration of this repo needs.
 *
 * An agency migration must be wired in two places by hand, and an orphan one
 * fails only at runtime — which is why these are asserted rather than trusted
 * (recorded project rule: `feedback_agency_migration_registration`).
 */
describe('CreateClientConversations1797500000000 registration', () => {
  it('is registered in the agency datasource migration list', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      CreateClientConversations1797500000000,
    );
  });

  it('registers all four entities for the agency connection', () => {
    expect(agencyEntities).toContain(ClientConversationEntity);
    expect(agencyEntities).toContain(ClientConversationParticipantEntity);
    expect(agencyEntities).toContain(ClientConversationMessageEntity);
    expect(agencyEntities).toContain(ClientConversationAttachmentEntity);
  });

  it('is ordered after the migration it depends on', () => {
    const migrations = (AgencyDataSource.options.migrations ?? []) as Array<{
      name?: string;
    }>;
    const names = migrations.map((migration) =>
      typeof migration === 'function'
        ? (migration as { name: string }).name
        : String(migration),
    );

    // `client_area_memberships` must exist: the participant table has an FK to
    // it, and the settings columns are added to CA3's tables.
    expect(names.indexOf('CreateClientConversations1797500000000')).toBeGreaterThan(
      names.indexOf('CreateClientAreaMemberships1797000000000'),
    );
    expect(names.indexOf('CreateClientConversations1797500000000')).toBeGreaterThan(
      names.indexOf('CreateClientAreaManagement1797150000000'),
    );
  });
});
