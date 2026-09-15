import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateSocialCampaignRecommendations1793400000000 } from './1793400000000-create-social-campaign-recommendations';

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

describe('social Campaign recommendations migration', () => {
  it('persists scoped advisory evidence and LLM provenance', async () => {
    const sql = await collectSql((queryRunner) =>
      new CreateSocialCampaignRecommendations1793400000000().up(queryRunner),
    );

    expect(sql).toContain('social_campaign_recommendations');
    expect(sql).toContain('evidence_snapshot');
    expect(sql).toContain('evidence_hash');
    expect(sql).toContain('prompt_version');
    expect(sql).toContain('cost_cents');
    expect(sql).not.toContain('accepted_at');
    expect(sql).not.toContain('applied_at');
    expect(sql).not.toContain('provider_operation_id');
  });

  it('is registered in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      CreateSocialCampaignRecommendations1793400000000,
    );
  });
});
