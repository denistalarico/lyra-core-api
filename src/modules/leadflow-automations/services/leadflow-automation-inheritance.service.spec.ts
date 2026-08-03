import { clearInheritedConfigFields } from './leadflow-automation.service';

describe('automation inherited editor values', () => {
  it('writes null only for the global-default matrix, retaining recipe-exclusive values', () => {
    expect(
      clearInheritedConfigFields('trigger', {
        type: 'conversation.idle',
        delayHours: 24,
        pipelineRef: 'pipeline-1',
        stageRef: 'stage-1',
        idleHoursInStage: 48,
      }),
    ).toEqual({
      type: 'conversation.idle',
      delayHours: null,
      pipelineRef: null,
      stageRef: null,
      idleHoursInStage: 48,
    });

    expect(
      clearInheritedConfigFields('actions', {
        primaryAction: 'schedule_followup',
        maxAttempts: 3,
      }),
    ).toEqual({ primaryAction: 'schedule_followup', maxAttempts: null });
  });
});
