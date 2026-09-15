import { CreateSocialBoostRequests1793700000000 } from './1793700000000-create-social-boost-requests';

describe('CreateSocialBoostRequests1793700000000', () => {
  it('adds explicit Boost opt-in and a scoped, idempotent audit', async () => {
    const sql: string[] = [];
    const runner = {
      query: jest.fn(async (statement: string) => sql.push(statement)),
    };
    await new CreateSocialBoostRequests1793700000000().up(runner as never);
    const joined = sql.join('\n');
    expect(joined).toContain('"allow_boost" boolean NOT NULL DEFAULT false');
    expect(joined).toContain(
      'CREATE TABLE IF NOT EXISTS "social_boost_requests"',
    );
    expect(joined).toContain('"UQ_social_boost_requests_request_id"');
    expect(joined).toContain(
      '"UQ_social_boost_requests_confirmation_request_id"',
    );
    expect(joined).toContain('"FK_social_boost_requests_publication"');
    expect(joined).toContain("'created_paused'");
    expect(joined).toContain('INSERT INTO platform_permissions');
    expect(joined).toContain('INSERT INTO platform_role_permissions');
  });
});
