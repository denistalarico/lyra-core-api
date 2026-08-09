import {
  LEADFLOW_BUSINESS_MODE_TEMPLATES,
  type LeadFlowBusinessModeTemplateCatalogItem,
} from './business-mode-templates.catalog';
import { LEADFLOW_CONTEXT_DEFAULT_PATHS } from './business-mode-context-defaults.catalog';
import {
  getCompanyContextRootKeys,
  getCompanyContextScalarFieldPaths,
} from '../services/company-context.service';
import { LeadFlowBusinessMode } from '../enums/leadflow-business-mode.enum';
import { readConversationPlaybook } from '../types/conversation-playbook.types';

describe('LeadFlow Business Mode conversation playbooks', () => {
  it('publishes one structured versioned playbook for every existing Business Mode', () => {
    expect(LEADFLOW_BUSINESS_MODE_TEMPLATES).toHaveLength(12);
    for (const template of LEADFLOW_BUSINESS_MODE_TEMPLATES) {
      const playbook = readConversationPlaybook(template.metadata);
      expect(playbook).toMatchObject({
        version: 2,
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

  it('requires name, niche and paid ads history before an agency CTA', () => {
    const template = LEADFLOW_BUSINESS_MODE_TEMPLATES.find(
      (item) => item.key === LeadFlowBusinessMode.AgencyServices,
    );
    const playbook = readConversationPlaybook(template?.metadata);

    expect(playbook?.ctaPolicy).toMatchObject({
      minimumContextFields: 3,
      requiredContextFields: ['lead_name', 'niche', 'paid_ads_experience'],
    });
  });
});

describe('LeadFlow Operations Room chat catalog', () => {
  it('publishes typed availability actions for every Business Mode', () => {
    for (const template of LEADFLOW_BUSINESS_MODE_TEMPLATES) {
      const operationsChat = template.metadata.operationsChat as {
        version?: number;
        readIntents?: unknown[];
        writeIntents?: unknown[];
        modeActions?: Array<{
          intent?: string;
          resourceKinds?: unknown[];
          requiredFields?: unknown[];
          owningCapability?: string;
        }>;
      };

      expect(operationsChat.version).toBe(1);
      expect(operationsChat.readIntents).toContain('general_report');
      expect(operationsChat.writeIntents).toContain('capacity_released');
      expect(operationsChat.modeActions).toHaveLength(2);
      expect(
        operationsChat.modeActions?.map((action) => action.intent),
      ).toEqual(
        expect.arrayContaining(['capacity_unavailable', 'capacity_released']),
      );

      for (const action of operationsChat.modeActions ?? []) {
        expect(action.resourceKinds?.length).toBeGreaterThan(0);
        expect(action.requiredFields).toEqual(
          expect.arrayContaining([
            'resourceRef',
            'effectivePeriod',
            'timezone',
          ]),
        );
        expect(['agenda', 'availability', 'inventory']).toContain(
          action.owningCapability,
        );
      }
    }
  });
});

describe('LeadFlow client prompt schema classification', () => {
  const VALID_PATHS = new Set([
    ...getCompanyContextScalarFieldPaths(),
    ...getCompanyContextRootKeys(),
  ]);

  function fieldsOf(template: LeadFlowBusinessModeTemplateCatalogItem) {
    return (
      template.clientPromptSchema as { fields: Array<Record<string, unknown>> }
    ).fields;
  }

  it('classifies every field by who fills it and where it shows', () => {
    for (const template of LEADFLOW_BUSINESS_MODE_TEMPLATES) {
      for (const field of fieldsOf(template)) {
        expect(['basic', 'advanced']).toContain(field.visibility);
        expect(['default', 'briefing', 'user']).toContain(field.source);
        expect(VALID_PATHS.has(field.contextPath as string)).toBe(true);
      }
    }
  });

  it('keeps the screen short: at most eight fields reach a non-technical owner', () => {
    for (const template of LEADFLOW_BUSINESS_MODE_TEMPLATES) {
      const basic = fieldsOf(template).filter(
        (field) => field.visibility === 'basic',
      );
      expect(basic.length).toBeLessThanOrEqual(8);
    }
  });

  it('never hides a required field behind Developer Mode', () => {
    for (const template of LEADFLOW_BUSINESS_MODE_TEMPLATES) {
      const hiddenRequired = fieldsOf(template).filter(
        (field) => field.required === true && field.visibility !== 'basic',
      );
      expect(hiddenRequired).toEqual([]);
    }
  });

  it('ships a value for every field it claims the Business Mode answers', () => {
    for (const template of LEADFLOW_BUSINESS_MODE_TEMPLATES) {
      const defaulted = fieldsOf(template).filter(
        (field) => field.source === 'default',
      );

      for (const field of defaulted) {
        const path = field.contextPath as string;
        // `languages` and `timezone` are answered by product-level fallbacks
        // rather than catalog copy; the rest must be shipped here.
        if (!LEADFLOW_CONTEXT_DEFAULT_PATHS.includes(path as never)) continue;

        const [section, leaf] = path.split('.');
        const value = (
          template.contextDefaults[section] as Record<string, unknown>
        )?.[leaf];
        expect(typeof value === 'string' && value.trim().length > 0).toBe(true);
      }
    }
  });

  it('never asks the company for a tone of voice', () => {
    // Tone is a property of the agent, not of the business: the same company
    // answers a price question and a complaint in different voices. It lives in
    // `behaviorConfig.tone`, edited per agent in the Agents module.
    for (const template of LEADFLOW_BUSINESS_MODE_TEMPLATES) {
      const toneFields = fieldsOf(template).filter(
        (field) => field.key === 'tone' || field.contextPath === 'legacyTone',
      );
      expect(toneFields).toEqual([]);
    }
  });

  it('gives all twelve modes their own conversion goal and CTA', () => {
    const goals = new Set<string>();

    for (const template of LEADFLOW_BUSINESS_MODE_TEMPLATES) {
      const qualification = template.contextDefaults.qualification as Record<
        string,
        string
      >;
      expect(qualification.conversionGoal).toBeTruthy();
      expect(qualification.preferredCta).toBeTruthy();
      goals.add(qualification.conversionGoal);
    }

    // A shared goal across every mode would mean the catalog is not really
    // per-niche, which is the whole reason it exists.
    expect(goals.size).toBeGreaterThan(8);
  });
});
