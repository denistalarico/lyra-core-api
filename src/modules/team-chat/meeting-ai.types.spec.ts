import {
  meetingAiCost,
  projectMeetingAi,
  type MeetingAiCall,
  type MeetingAiExecution,
} from './meeting-ai.types';

describe('Meeting AI usage projection', () => {
  const call = {
    costUsd: 0.01234,
    inputTokens: 30,
    outputTokens: 20,
  } as MeetingAiCall;
  it('keeps unknown charges unknown and sums all attempts', () => {
    expect(meetingAiCost([call, call])).toBe(0.02468);
    expect(meetingAiCost([call, { ...call, costUsd: null }])).toBeNull();
  });
  it('does not expose recording keys, provider state or credentials', () => {
    const execution = {
      stage: 'capturing',
      config: {},
      calls: [call],
      audioRef: 'private/audio.mp3',
      egressId: 'egress-secret',
      accountName: 'IA',
      costCenterName: 'Operações',
    } as MeetingAiExecution;
    const result = projectMeetingAi({
      id: 'summary',
      status: 'processing',
      execution,
      errorMessage: null,
      completedAt: null,
    });
    expect(result).toMatchObject({
      stage: 'capturing',
      inputTokens: 30,
      outputTokens: 20,
      costUsd: 0.01234,
    });
    expect(JSON.stringify(result)).not.toMatch(/private\/|egress-secret/);
    expect(
      projectMeetingAi({
        id: 'legacy',
        status: 'pending',
        execution: null,
        errorMessage: null,
        completedAt: null,
      }),
    ).toBeNull();
  });
});
