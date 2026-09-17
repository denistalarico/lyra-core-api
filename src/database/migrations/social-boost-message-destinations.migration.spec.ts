import { AgencyDataSource } from '../agency-typeorm.datasource';
import { AddSocialBoostMessageDestinations1793800000000 } from './1793800000000-add-social-boost-message-destinations';

describe('AddSocialBoostMessageDestinations1793800000000', () => {
  it('adds the scoped message channel configuration without rewriting templates', async () => {
    const sql: string[] = [];
    const runner = {
      query: jest.fn(async (statement: string) => sql.push(statement)),
    };

    await new AddSocialBoostMessageDestinations1793800000000().up(
      runner as never,
    );

    expect(sql.join('\n')).toContain('"message_destinations" jsonb NOT NULL');
    expect(sql.join('\n')).toContain('"whatsappPhoneNumber":null');
  });

  it('is registered in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      AddSocialBoostMessageDestinations1793800000000,
    );
  });
});
