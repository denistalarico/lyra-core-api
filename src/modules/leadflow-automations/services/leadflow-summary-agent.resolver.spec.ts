import type { DataSource } from 'typeorm';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { LeadFlowSummaryAgentResolver } from './leadflow-summary-agent.resolver';

function build(agents: Array<Record<string, unknown> | null>) {
  let call = 0;
  const conditions: string[] = [];
  const getOne = jest.fn().mockImplementation(() => {
    const next = agents[call] ?? null;
    call += 1;
    return Promise.resolve(next);
  });
  const builder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn((clause: string) => {
      conditions.push(clause);
      return builder;
    }),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getOne,
  };
  const dataSource = {
    getRepository: () => ({ createQueryBuilder: () => builder }),
  } as unknown as DataSource;

  return { resolver: new LeadFlowSummaryAgentResolver(dataSource), conditions };
}

const agencyScope = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  contextType: LeadFlowSettingsContextType.Agency,
  agencyClientId: null,
};

describe('LeadFlowSummaryAgentResolver', () => {
  it('signs with the agent that is on duty', async () => {
    const { resolver, conditions } = build([
      { id: 'agent-1', name: 'Sofia', type: 'reception' },
    ]);

    await expect(resolver.resolve(agencyScope)).resolves.toEqual({
      id: 'agent-1',
      name: 'Sofia',
      type: 'reception',
    });
    expect(conditions).toContain('agent.published_version_id IS NOT NULL');
  });

  it('falls back to a configured agent when none is published', async () => {
    const { resolver } = build([
      null,
      { id: 'agent-2', name: 'Ravi', type: 'sales' },
    ]);

    await expect(resolver.resolve(agencyScope)).resolves.toMatchObject({
      id: 'agent-2',
      name: 'Ravi',
    });
  });

  it('signs as the product when the workspace has no agent at all', async () => {
    const { resolver } = build([null, null]);

    await expect(resolver.resolve(agencyScope)).resolves.toEqual({
      id: null,
      name: 'Lyra',
      type: null,
    });
  });

  it('stays inside the context the automation belongs to', async () => {
    const { resolver, conditions } = build([null, null]);

    await resolver.resolve({
      ...agencyScope,
      contextType: LeadFlowSettingsContextType.Client,
      agencyClientId: 'client-9',
    });

    expect(conditions).toContain('agent.agency_client_id = :agencyClientId');
    expect(conditions).not.toContain('agent.agency_client_id IS NULL');
  });
});
