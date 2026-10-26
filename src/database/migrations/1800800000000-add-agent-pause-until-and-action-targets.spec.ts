import { AgencyDataSource } from '../agency-typeorm.datasource';
import { AddAgentPauseUntilAndActionTargets1800800000000 } from './1800800000000-add-agent-pause-until-and-action-targets';

describe('AddAgentPauseUntilAndActionTargets1800800000000', () => {
  const sqlOf = async (direction: 'up' | 'down') => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddAgentPauseUntilAndActionTargets1800800000000()[direction]({
      query,
    } as never);
    return query.mock.calls.map(([statement]) => String(statement)).join('\n');
  };

  it('is registered in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      AddAgentPauseUntilAndActionTargets1800800000000,
    );
  });

  it('adds the timed pause, the agent/target columns and the OR5 intents', async () => {
    const sql = await sqlOf('up');
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "paused_until" timestamptz',
    );
    expect(sql).toContain('"IDX_lf_agents_paused_until_due"');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "agent_id" uuid');
    expect(sql).toContain('ON DELETE SET NULL');
    expect(sql).toContain("'pause_agent','activate_agent','create_contact'");
    expect(sql).toContain("'capacity_released'");
  });

  it('down restores the previous intent CHECK without failing on OR5 rows', async () => {
    const sql = await sqlOf('down');
    expect(sql).toContain('NOT VALID');
    expect(sql).not.toContain("'pause_agent'");
    expect(sql).toContain('DROP COLUMN IF EXISTS "paused_until"');
  });
});
