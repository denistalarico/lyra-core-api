import type { LeadFlowAutomationAction } from '../types/leadflow-automation.types';
import {
  executorAvailability,
  unavailableExecutors,
} from './automation-executors.registry';

const ACTIONS: LeadFlowAutomationAction[] = [
  'send_message',
  'schedule_followup',
  'notify_user',
  'move_opportunity_stage',
  'transfer_opportunity_pipeline',
  'copy_opportunity',
  'update_opportunity_score',
  'add_tag',
  'request_missing_fields',
  'request_handoff',
  'create_task',
  'send_webhook',
  'append_note',
  'generate_summary_placeholder',
];

describe('automation executor registry', () => {
  it('registers every action explicitly with an owning domain and description', () => {
    for (const action of ACTIONS) {
      const availability = executorAvailability(action);
      expect(availability.actionKey).toBe(action);
      expect(availability.owningDomain).not.toBe('unknown');
      expect(availability.description).toBeTruthy();
    }
  });

  it('reports the governed stage transition as available now that a real executor exists', () => {
    // Its dependency (StageTransitionCommand) is satisfied; capability is real.
    // Whether it is permitted to run is the execution gate's separate decision.
    const availability = executorAvailability('move_opportunity_stage');
    expect(availability.available).toBe(true);
    expect(availability.owningDomain).toBe('leadflow.crm');
  });

  it('still fails closed for CRM commands with no automatic adapter yet', () => {
    for (const action of [
      'transfer_opportunity_pipeline',
      'copy_opportunity',
    ]) {
      const availability = executorAvailability(action);
      expect(availability.available).toBe(false);
      expect(availability.reason).toBe('not_implemented');
      expect(availability.owningDomain).toBe('leadflow.crm');
    }
  });

  it('deduplicates configured action keys', () => {
    expect(unavailableExecutors(['add_tag', 'add_tag'])).toHaveLength(1);
  });
});
