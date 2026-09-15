import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateSocialAdGovernedActions1793500000000 } from './1793500000000-create-social-ad-governed-actions';

function collectSql(run: (queryRunner: never) => Promise<void>) {
  const sql: string[] = [];
  const queryRunner = {
    query: jest.fn((statement: string) => {
      sql.push(statement);
      return Promise.resolve();
    }),
  };
  return run(queryRunner as never).then(() => sql.join('\n'));
}

describe('social ad governed actions migration', () => {
  it('stores opt-in policy, immutable intent and sanitized execution evidence', async () => {
    const sql = await collectSql((runner) =>
      new CreateSocialAdGovernedActions1793500000000().up(runner),
    );
    expect(sql).toContain('social_ad_action_policies');
    expect(sql).toContain('social_ad_governed_actions');
    expect(sql).toContain('confirmation_request_id');
    expect(sql).toContain('before_snapshot');
    expect(sql).toContain('provider_result');
    expect(sql).not.toContain('access_token');
    expect(sql).not.toContain('recommendation_id');
  });

  it('is registered in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      CreateSocialAdGovernedActions1793500000000,
    );
  });
});
