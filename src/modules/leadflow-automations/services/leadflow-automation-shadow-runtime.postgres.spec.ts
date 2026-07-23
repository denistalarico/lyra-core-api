import { randomUUID } from 'node:crypto';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities';
import {
  LeadFlowAutomationEntity,
  LeadFlowAutomationRunAttemptEntity,
  LeadFlowAutomationRunEntity,
  LeadFlowAutomationVersionEntity,
} from '../entities';
import {
  LeadFlowAutomationAttemptStatus,
  LeadFlowAutomationRunMode,
  LeadFlowAutomationRunStatus,
} from '../enums/leadflow-automation-run.enums';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import { LeadFlowAutomationVersionStatus } from '../enums/leadflow-automation-version-status.enum';
import type { LeadFlowAutomationRuntimeContract } from '../types/leadflow-automation.types';
import { LeadFlowAutomationContextService } from './leadflow-automation-context.service';
import { LeadFlowAutomationEvaluationService } from './leadflow-automation-evaluation.service';
import { LeadFlowAutomationEventIngressService } from './leadflow-automation-event-ingress.service';
import { LeadFlowAutomationRunService } from './leadflow-automation-run.service';
import { LeadFlowAutomationShadowEvaluatorService } from './leadflow-automation-shadow-evaluator.service';
import { LeadFlowAutomationTriggerMatcherService } from './leadflow-automation-trigger-matcher.service';
import { LeadFlowAutomationContextLoaderService } from './leadflow-automation-context-loader.service';
import { CrmOpportunityFieldCatalogService } from '../../crm/services/crm-opportunity-field-catalog.service';
import { LeadScoreQueryService } from '../../crm/lead-score/services/lead-score-query.service';
import { CrmLeadScoreStateEntity } from '../../crm/lead-score/entities/crm-lead-score-state.entity';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { InboxConversationEntity } from '../../inbox/entities/inbox-conversation.entity';
import { InboxMessageEntity } from '../../inbox/entities/inbox-message.entity';
import { InboxSettingsEntity } from '../../inbox/entities/inbox-settings.entity';
import { LeadFlowBusinessModeTemplateEntity } from '../../leadflow-settings/entities';

const run =
  process.env.INBOX_PG_INTEGRATION === 'true' ? describe : describe.skip;

run('LeadFlow Automations shadow runtime PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  let ingress: LeadFlowAutomationEventIngressService;
  let shadowEvaluator: LeadFlowAutomationShadowEvaluatorService;

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    const matcher = new LeadFlowAutomationTriggerMatcherService(
      AgencyDataSource.getRepository(LeadFlowAutomationEntity),
      AgencyDataSource.getRepository(LeadFlowAutomationVersionEntity),
    );
    const runService = new LeadFlowAutomationRunService(
      AgencyDataSource.getRepository(LeadFlowAutomationRunEntity),
      AgencyDataSource.getRepository(LeadFlowAutomationRunAttemptEntity),
      AgencyDataSource,
    );
    const fieldCatalog = new CrmOpportunityFieldCatalogService(
      AgencyDataSource.getRepository(LeadFlowBusinessModeTemplateEntity),
    );
    const loader = new LeadFlowAutomationContextLoaderService(
      AgencyDataSource.getRepository(InboxConversationEntity),
      AgencyDataSource.getRepository(InboxMessageEntity),
      AgencyDataSource.getRepository(InboxSettingsEntity),
      AgencyDataSource.getRepository(CrmOpportunityEntity),
      AgencyDataSource.getRepository(LeadFlowAutomationRunEntity),
      new LeadScoreQueryService(
        AgencyDataSource.getRepository(CrmLeadScoreStateEntity),
      ),
      fieldCatalog,
    );
    shadowEvaluator = new LeadFlowAutomationShadowEvaluatorService(
      matcher,
      new LeadFlowAutomationContextService(loader),
      new LeadFlowAutomationEvaluationService(),
      runService,
    );
    ingress = new LeadFlowAutomationEventIngressService(
      AgencyDataSource,
      shadowEvaluator,
    );
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  beforeEach(async () => {
    await AgencyDataSource.query(
      `TRUNCATE leadflow_automation_run_attempts, leadflow_automation_runs,
       leadflow_event_deliveries, leadflow_automation_versions,
       leadflow_automations RESTART IDENTITY CASCADE`,
    );
  });

  it('persists one no-effect run pinned to the published snapshot before acknowledging', async () => {
    const { automationId, versionId } = await insertPublishedAutomation();
    const deliveryId = await insertDelivery();

    await expect(ingress.processPending()).resolves.toBe(1);

    const delivery = await AgencyDataSource.getRepository(
      LeadFlowEventDeliveryEntity,
    ).findOneByOrFail({ id: deliveryId });
    expect(delivery.status).toBe('delivered');

    const runs = await AgencyDataSource.getRepository(
      LeadFlowAutomationRunEntity,
    ).findBy({ automationId });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      automationVersionId: versionId,
      mode: LeadFlowAutomationRunMode.Shadow,
      status: LeadFlowAutomationRunStatus.Succeeded,
      sourceEventId: delivery.sourceEventId,
      triggerType: 'opportunity.created',
    });
    expect(runs[0].result).toMatchObject({
      wouldAct: true,
      blockedByExecutor: true,
      executedAnything: false,
      plannedActions: ['notify_user'],
    });

    const attempts = await AgencyDataSource.getRepository(
      LeadFlowAutomationRunAttemptEntity,
    ).findBy({ runId: runs[0].id });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      actionKey: 'notify_user',
      status: LeadFlowAutomationAttemptStatus.Simulated,
      effectConfirmed: false,
    });
  });

  it('serializes concurrent replay and keeps the first published version', async () => {
    const { automationId, versionId } = await insertPublishedAutomation();
    const deliveryId = await insertDelivery();
    const delivery = await AgencyDataSource.getRepository(
      LeadFlowEventDeliveryEntity,
    ).findOneByOrFail({ id: deliveryId });

    await Promise.all([
      shadowEvaluator.evaluateDelivery(delivery),
      shadowEvaluator.evaluateDelivery(delivery),
    ]);

    const nextVersionId = randomUUID();
    const nextSnapshot = publishedSnapshot(automationId, {
      actions: { primaryAction: 'send_message' },
    });
    await AgencyDataSource.query(
      `INSERT INTO leadflow_automation_versions
        (id, tenant_id, automation_id, version, status, snapshot)
       VALUES ($1, $2, $3, 2, 'published', $4::jsonb)`,
      [nextVersionId, tenantId, automationId, JSON.stringify(nextSnapshot)],
    );
    await AgencyDataSource.query(
      'UPDATE leadflow_automations SET published_version_id=$1 WHERE id=$2',
      [nextVersionId, automationId],
    );
    await shadowEvaluator.evaluateDelivery(delivery);

    const runs = await AgencyDataSource.getRepository(
      LeadFlowAutomationRunEntity,
    ).findBy({ automationId });
    expect(runs).toHaveLength(1);
    expect(runs[0].automationVersionId).toBe(versionId);
    expect(runs[0].result.plannedActions).toEqual(['notify_user']);
  });

  it('isolates workspaces and records paused automations as not active', async () => {
    const paused = await insertPublishedAutomation({
      status: LeadFlowAutomationStatus.Paused,
    });
    await insertPublishedAutomation({ workspaceId: randomUUID() });
    await insertDelivery();

    await ingress.processPending();

    const runs = await AgencyDataSource.getRepository(
      LeadFlowAutomationRunEntity,
    ).find();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      automationId: paused.automationId,
      status: LeadFlowAutomationRunStatus.Skipped,
      skipReason: 'not_active',
      attemptCount: 0,
    });
  });

  async function insertPublishedAutomation(
    overrides: {
      workspaceId?: string;
      status?: LeadFlowAutomationStatus;
    } = {},
  ): Promise<{ automationId: string; versionId: string }> {
    const targetWorkspace = overrides.workspaceId ?? workspaceId;
    const automationId = randomUUID();
    const versionId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO leadflow_automations
        (id, tenant_id, workspace_id, business_mode_key, recipe_key,
         template_version, name, category, status, trigger_config,
         condition_config, action_config, message_config, crm_policy,
         schedule_policy, developer_config, webhook_config, readiness, metadata)
       VALUES ($1, $2, $3, 'agency_services', 'lead_distribution', 2,
         'Shadow automation', 'crm', $4, '{"type":"manual"}',
         '{"minScore":999}', '{"primaryAction":"send_message"}',
         '{}', '{}', '{}', '{}', '{}', '{}', '{}')`,
      [
        automationId,
        tenantId,
        targetWorkspace,
        overrides.status ?? LeadFlowAutomationStatus.Active,
      ],
    );
    const snapshot = publishedSnapshot(automationId, {
      workspaceId: targetWorkspace,
    });
    await AgencyDataSource.query(
      `INSERT INTO leadflow_automation_versions
        (id, tenant_id, automation_id, version, status, snapshot)
       VALUES ($1, $2, $3, 1, $4, $5::jsonb)`,
      [
        versionId,
        tenantId,
        automationId,
        LeadFlowAutomationVersionStatus.Published,
        JSON.stringify(snapshot),
      ],
    );
    await AgencyDataSource.query(
      'UPDATE leadflow_automations SET published_version_id=$1 WHERE id=$2',
      [versionId, automationId],
    );
    return { automationId, versionId };
  }

  async function insertDelivery(): Promise<string> {
    const id = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO leadflow_event_deliveries
        (id, source_event_id, consumer_key, tenant_id, workspace_id,
         event_name, event_version, aggregate_type, aggregate_id,
         source_idempotency_key, payload, occurred_at)
       VALUES ($1, $2, 'leadflow.automations', $3, $4,
         'leadflow.crm.opportunity.created', 1, 'crm_opportunity', $5,
         $6, '{"score":82}', now())`,
      [id, randomUUID(), tenantId, workspaceId, randomUUID(), randomUUID()],
    );
    return id;
  }

  function publishedSnapshot(
    automationId: string,
    overrides: Partial<LeadFlowAutomationRuntimeContract> = {},
  ): LeadFlowAutomationRuntimeContract {
    return {
      version: 1,
      generatedAt: '2026-07-22T12:00:00.000Z',
      tenantId,
      workspaceId,
      automationId,
      recipeKey: 'lead_distribution',
      name: 'Published shadow automation',
      category: 'crm',
      status: LeadFlowAutomationStatus.Active,
      businessMode: { key: 'agency_services', isCustom: false },
      leadflowSettingsSnapshot: {
        settingsId: null,
        contextType: 'agency',
        status: 'active',
        planKey: null,
        developerModeEnabled: false,
      },
      trigger: { type: 'opportunity.created' },
      conditions: {},
      actions: { primaryAction: 'notify_user' },
      message: {},
      crmPolicy: {},
      schedulePolicy: {},
      developerConfig: {},
      webhook: null,
      safetyRules: [],
      readiness: {},
      publishedVersionId: null,
      ...overrides,
    };
  }
});
