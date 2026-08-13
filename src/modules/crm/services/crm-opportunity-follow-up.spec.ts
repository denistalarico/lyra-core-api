import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FOLLOWUP_STEP_KEYS } from '../../leadflow-automations/catalog/followup-plan.catalog';
import { PatchCrmOpportunityFollowStepDto } from '../dto/patch-crm-opportunity-follow.dto';
import type { CrmOpportunityEntity } from '../entities/crm-opportunity.entity';
import {
  readOpportunityFollowUp,
  writeOpportunityFollowUp,
} from './crm-opportunity-follow-up';

type FollowUpCard = Pick<
  CrmOpportunityEntity,
  'followMode' | 'followMessage' | 'metadata'
>;

function card(overrides: Partial<FollowUpCard> = {}): FollowUpCard {
  return {
    followMode: 'automatic',
    followMessage: null,
    metadata: {},
    ...overrides,
  };
}

describe('opportunity follow-up state', () => {
  it('reads a card that predates the two-text cadence', () => {
    const state = readOpportunityFollowUp(
      card({ followMessage: 'Voltamos a falar?' }),
    );
    expect(state).toMatchObject({
      mode: 'automatic',
      steps: null,
      texts: { d0: 'Voltamos a falar?', d1: null },
      textsSource: null,
    });
  });

  it('falls back to no follow-up when the stored mode is not a mode', () => {
    expect(readOpportunityFollowUp(card({ followMode: 'sim' })).mode).toBe(
      'disabled',
    );
  });

  it('keeps the first text in its column so older readers still see it', () => {
    const subject = card();
    writeOpportunityFollowUp(subject, {
      texts: { d0: 'Hoje ainda', d1: 'E amanhã' },
      textsSource: 'agent',
    });

    expect(subject.followMessage).toBe('Hoje ainda');
    expect(readOpportunityFollowUp(subject)).toMatchObject({
      texts: { d0: 'Hoje ainda', d1: 'E amanhã' },
      textsSource: 'agent',
    });
  });

  it('writes only what it was given', () => {
    const subject = card({ followMessage: 'Rascunho do agente' });
    writeOpportunityFollowUp(subject, { mode: 'manual' });

    expect(subject.followMode).toBe('manual');
    // Switching the mode is not the same as clearing what was written.
    expect(readOpportunityFollowUp(subject).texts.d0).toBe('Rascunho do agente');
  });

  it('keeps the plan across a switch back to automatic', () => {
    const subject = card();
    writeOpportunityFollowUp(subject, {
      mode: 'manual',
      steps: [{ stepKey: 'd0', enabled: true, delayMinutes: 120, channels: [] }],
    });
    writeOpportunityFollowUp(subject, { mode: 'automatic' });

    expect(readOpportunityFollowUp(subject).steps).toHaveLength(1);
  });

  it('does not lose metadata that belongs to somebody else', () => {
    const subject = card({ metadata: { clientId: 'client-1' } });
    writeOpportunityFollowUp(subject, { mode: 'disabled' });
    expect(subject.metadata.clientId).toBe('client-1');
  });

  it('accepts exactly the attempts the cadence declares, and no others', async () => {
    // The DTO cannot import the catalog — the CRM does not depend on LeadFlow
    // Automations, and inverting that would close a cycle — so this is what
    // keeps the two lists from drifting apart.
    for (const stepKey of FOLLOWUP_STEP_KEYS) {
      expect(await stepKeyErrors(stepKey)).toEqual([]);
    }
    expect(await stepKeyErrors('d2')).toContain('stepKey');
  });
});

async function stepKeyErrors(stepKey: string): Promise<string[]> {
  const step = plainToInstance(PatchCrmOpportunityFollowStepDto, {
    stepKey,
    enabled: true,
    delayMinutes: 180,
    channels: [],
  });
  const errors = await validate(step);
  return errors.map((error) => error.property);
}
