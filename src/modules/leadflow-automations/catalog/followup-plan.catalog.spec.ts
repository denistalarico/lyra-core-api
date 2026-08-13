import {
  clampD0Hours,
  enabledFollowupSteps,
  FOLLOWUP_STEP_DELAY_MINUTES,
  normalizeFollowupPlan,
  toStoredFollowupSteps,
} from './followup-plan.catalog';
import { getRecipeByKey } from './automation-recipes.catalog';

describe('followup plan catalog', () => {
  it('always yields the four named attempts, in cadence order', () => {
    expect(normalizeFollowupPlan(null).map((step) => step.stepKey)).toEqual([
      'd0',
      'd1',
      'd3',
      'd7',
    ]);
  });

  it('derives the delay from the key, not from what was stored', () => {
    const [, dayOne, dayThree] = normalizeFollowupPlan([
      { stepKey: 'd1', delayMinutes: 999, channels: [] },
      { stepKey: 'd3', delayMinutes: 1, channels: [] },
    ]);
    expect(dayOne.delayMinutes).toBe(FOLLOWUP_STEP_DELAY_MINUTES.d1);
    expect(dayThree.delayMinutes).toBe(FOLLOWUP_STEP_DELAY_MINUTES.d3);
  });

  it('keeps the same-day attempt configurable inside its band', () => {
    const [step] = normalizeFollowupPlan([
      { stepKey: 'd0', enabled: true, delayMinutes: 300, channels: [] },
    ]);
    expect(step.delayMinutes).toBe(300);
    expect(clampD0Hours(0)).toBe(1);
    expect(clampD0Hours(48)).toBe(6);
    expect(clampD0Hours('cedo')).toBe(3);
  });

  it('reads a legacy same-day d1 as the attempt it was meant to be', () => {
    // The old screen had one field — a delay in minutes — so an operator who
    // wanted a follow-up in five hours put five hours on `d1`. That intent is
    // the new `d0`, and dropping it would silently move their follow-up to the
    // next day.
    const plan = normalizeFollowupPlan([
      {
        stepKey: 'd1',
        delayMinutes: 300,
        channels: [
          { channel: 'whatsapp', enabled: true, connectionRef: 'channel-1' },
        ],
      },
    ]);
    expect(plan[0]).toMatchObject({
      stepKey: 'd0',
      enabled: true,
      delayMinutes: 300,
    });
    expect(plan[1]).toMatchObject({ stepKey: 'd1', enabled: false });
  });

  it('treats a legacy step with a switched-on channel as enabled', () => {
    const plan = normalizeFollowupPlan([
      {
        stepKey: 'd3',
        delayMinutes: 4320,
        channels: [{ channel: 'whatsapp', enabled: true }],
      },
      {
        stepKey: 'd7',
        delayMinutes: 10080,
        channels: [{ channel: 'whatsapp', enabled: false }],
      },
    ]);
    expect(plan[2].enabled).toBe(true);
    expect(plan[3].enabled).toBe(false);
  });

  it('strips channels from the attempts that answer in the conversation', () => {
    // Offering a channel there is what would let a lead who wrote on Instagram
    // be answered on WhatsApp.
    const [sameDay] = normalizeFollowupPlan([
      {
        stepKey: 'd0',
        enabled: true,
        delayMinutes: 180,
        channels: [{ channel: 'whatsapp', enabled: true }],
      },
    ]);
    expect(sameDay.channels).toEqual([]);
  });

  it('gives the chain only the attempts that are switched on', () => {
    const enabled = enabledFollowupSteps([
      { stepKey: 'd0', enabled: true, delayMinutes: 180, channels: [] },
      { stepKey: 'd1', enabled: false, delayMinutes: 1320, channels: [] },
      {
        stepKey: 'd7',
        enabled: true,
        delayMinutes: 10080,
        channels: [{ channel: 'whatsapp', enabled: true }],
      },
    ]);
    expect(enabled.map((step) => step.stepKey)).toEqual(['d0', 'd7']);
  });

  it('round-trips to the stored shape', () => {
    const stored = toStoredFollowupSteps(normalizeFollowupPlan(null));
    expect(stored).toHaveLength(4);
    expect(Object.keys(stored[0]).sort()).toEqual([
      'channels',
      'delayMinutes',
      'enabled',
      'stepKey',
    ]);
  });

  it('ships the recipe with a plan that is already complete', () => {
    // D+0 and D+1 need no channel, so the automation can be switched on the
    // moment it is provisioned.
    const recipe = getRecipeByKey('followup_idle_lead')!;
    const enabled = enabledFollowupSteps(
      recipe.defaultMessageConfig.followupSteps,
    );
    expect(enabled.map((step) => step.stepKey)).toEqual(['d0', 'd1']);
  });
});
