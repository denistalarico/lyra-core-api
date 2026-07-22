import { LEADFLOW_BUSINESS_MODE_TEMPLATES } from './business-mode-templates.catalog';
import { LeadFlowBusinessMode } from '../enums/leadflow-business-mode.enum';
import { readConversationPlaybook } from '../types/conversation-playbook.types';

describe('LeadFlow Business Mode conversation playbooks', () => {
  it('publishes one structured versioned playbook for every existing Business Mode', () => {
    expect(LEADFLOW_BUSINESS_MODE_TEMPLATES).toHaveLength(12);
    for (const template of LEADFLOW_BUSINESS_MODE_TEMPLATES) {
      const playbook = readConversationPlaybook(template.metadata);
      expect(playbook).toMatchObject({
        version: 1,
        businessModeKey: template.key,
      });
      expect(playbook?.phases.map((phase) => phase.key)).toEqual([
        'understand',
        'qualify',
        'convert',
      ]);
      expect(playbook?.ctaPolicy.allowed.length).toBeGreaterThan(0);
      expect(playbook?.ctaPolicy.maxAgentRepliesWithoutCta).toBe(3);
    }
  });

  it.each([
    [LeadFlowBusinessMode.AgencyServices, 'schedule_diagnostic'],
    [LeadFlowBusinessMode.LocalServices, 'request_quote'],
    [LeadFlowBusinessMode.ClinicsEsthetics, 'request_evaluation'],
    [LeadFlowBusinessMode.RestaurantsFood, 'provide_order_details'],
  ])('covers the golden mode %s with its safe CTA', (key, expectedCta) => {
    const template = LEADFLOW_BUSINESS_MODE_TEMPLATES.find(
      (item) => item.key === key,
    );
    const playbook = readConversationPlaybook(template?.metadata);
    expect(playbook?.ctaPolicy.allowed).toContain(expectedCta);
  });
});
