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
  it('registers every action explicitly and fails closed', () => {
    for (const action of ACTIONS) {
      const availability = executorAvailability(action);
      expect(availability.actionKey).toBe(action);
      expect(availability.available).toBe(false);
      expect(availability.owningDomain).not.toBe('unknown');
      expect(availability.description).toBeTruthy();
    }
  });

  it('does not confuse a callable CRM command with an automatic adapter', () => {
    for (const action of [
      'move_opportunity_stage',
      'transfer_opportunity_pipeline',
      'copy_opportunity',
    ]) {
      const availability = executorAvailability(action);
      expect(availability.reason).toBe('not_implemented');
      expect(availability.dependency).toBeNull();
      expect(availability.owningDomain).toBe('leadflow.crm');
    }
  });

  it('deduplicates configured action keys', () => {
    expect(unavailableExecutors(['add_tag', 'add_tag'])).toHaveLength(1);
  });
});
