import { LeadFlowAgentChannelStatus } from '../enums/leadflow-agent-channel-status.enum';
import { computeAgentReadiness } from './agent-readiness';

const ready = {
  agent: { name: 'Recepção', publishedVersionId: 'version-9' },
  settings: {
    clientPromptConfig: { businessName: 'Clínica X' },
    companyContextPublished: {},
  },
  bindings: [{ status: LeadFlowAgentChannelStatus.Active }],
};

describe('computeAgentReadiness', () => {
  it('reports a fully configured agent as ready with a perfect score', () => {
    const result = computeAgentReadiness(
      ready.agent,
      ready.settings,
      ready.bindings,
    );
    expect(result).toMatchObject({ level: 'ready', score: 100, missing: [] });
    expect(result.checkedAt).toEqual(expect.any(String));
  });

  it('drops to partial when only the published version is missing', () => {
    const result = computeAgentReadiness(
      { name: 'Recepção', publishedVersionId: null },
      ready.settings,
      ready.bindings,
    );
    expect(result.level).toBe('partial');
    expect(result.missing).toEqual(['published_version']);
    expect(result.score).toBe(75);
  });

  it('is not_ready when two or more dependencies are missing', () => {
    const result = computeAgentReadiness(
      { name: 'Recepção', publishedVersionId: null },
      ready.settings,
      [{ status: LeadFlowAgentChannelStatus.Unbound }],
    );
    expect(result.level).toBe('not_ready');
    expect(result.missing).toEqual(
      expect.arrayContaining(['channels', 'published_version']),
    );
  });

  it('treats absent settings as a missing client context', () => {
    const result = computeAgentReadiness(ready.agent, null, ready.bindings);
    expect(result.missing).toContain('client_context');
  });

  it('accepts the published company context when the prompt config is empty', () => {
    const result = computeAgentReadiness(
      ready.agent,
      { clientPromptConfig: {}, companyContextPublished: { identity: {} } },
      ready.bindings,
    );
    expect(result.missing).not.toContain('client_context');
  });
});
