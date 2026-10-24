import { randomUUID } from 'crypto';
import { AgencyDataSource } from '../../../../database/agency-typeorm.datasource';
import { describePostgresIntegration } from '../../../../testing/postgres-integration';
import { deleteFixtureTenant } from '../../../../testing/fixture-tenant';
import {
  findOpportunityIdsForAppointment,
  loadLatestAppointmentOutcome,
} from './lead-score-appointments';

const run = describePostgresIntegration();

run('Lead score appointment linkage PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const scope = { tenantId, workspaceId };

  const resetFixtures = () =>
    deleteFixtureTenant(AgencyDataSource, tenantId, [
      'scheduled_items',
      'crm_opportunities',
      'crm_stages',
      'crm_pipelines',
      'contacts',
    ]);

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) {
      await resetFixtures();
      await AgencyDataSource.destroy();
    }
  });

  beforeEach(resetFixtures);

  async function insertOpportunity(contactId: string | null) {
    const pipelineId = randomUUID();
    const stageId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO crm_pipelines (id,tenant_id,workspace_id,name,scope_kind)
       VALUES ($1,$2,$3,$4,'agency')`,
      [pipelineId, tenantId, workspaceId, `Pipeline ${pipelineId}`],
    );
    await AgencyDataSource.query(
      `INSERT INTO crm_stages (id,tenant_id,workspace_id,pipeline_id,name)
       VALUES ($1,$2,$3,$4,'Novo')`,
      [stageId, tenantId, workspaceId, pipelineId],
    );
    const [row] = await AgencyDataSource.query<
      Array<{ id: string; created_at: Date }>
    >(
      `INSERT INTO crm_opportunities
        (tenant_id,workspace_id,pipeline_id,stage_id,contact_id,title,scope_kind)
       VALUES ($1,$2,$3,$4,$5,'Opportunity','agency')
       RETURNING id, created_at`,
      [tenantId, workspaceId, pipelineId, stageId, contactId],
    );
    return {
      id: row.id,
      tenantId,
      workspaceId,
      contactId,
      createdAt: row.created_at,
    };
  }

  async function insertContact() {
    const id = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO contacts (id,tenant_id,workspace_id,type,display_name)
       VALUES ($1,$2,$3,'person','Lead')`,
      [id, tenantId, workspaceId],
    );
    return id;
  }

  async function insertAppointment(input: {
    contactId?: string | null;
    opportunityId?: string | null;
    lifecycle: string;
    startAt: string;
  }) {
    const id = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO scheduled_items
        (id,tenant_id,workspace_id,scope_kind,type,title,start_at,contact_id,
         source_opportunity_id,metadata)
       VALUES ($1,$2,$3,'agency','meeting','Reunião',$4,$5,$6,$7::jsonb)`,
      [
        id,
        tenantId,
        workspaceId,
        input.startAt,
        input.contactId ?? null,
        input.opportunityId ?? null,
        JSON.stringify({ appointmentStatus: input.lifecycle }),
      ],
    );
    return id;
  }

  it('reports none without linked appointments', async () => {
    const opportunity = await insertOpportunity(await insertContact());
    await expect(
      loadLatestAppointmentOutcome(AgencyDataSource.manager, opportunity),
    ).resolves.toBe('none');
  });

  it('uses the latest non-cancelled appointment of the contact', async () => {
    const contactId = await insertContact();
    const opportunity = await insertOpportunity(contactId);
    await insertAppointment({
      contactId,
      lifecycle: 'no_show',
      startAt: '2026-10-20T13:00:00Z',
    });
    const confirmed = await insertAppointment({
      contactId,
      lifecycle: 'confirmed',
      startAt: '2026-10-22T13:00:00Z',
    });
    await insertAppointment({
      contactId,
      lifecycle: 'canceled',
      startAt: '2026-10-25T13:00:00Z',
    });

    await expect(
      loadLatestAppointmentOutcome(AgencyDataSource.manager, opportunity),
    ).resolves.toBe('accepted');
    await expect(
      findOpportunityIdsForAppointment(
        AgencyDataSource.manager,
        scope,
        confirmed,
      ),
    ).resolves.toEqual([opportunity.id]);
  });

  it('penalises a no-show on the explicitly linked opportunity', async () => {
    const opportunity = await insertOpportunity(null);
    const appointmentId = await insertAppointment({
      opportunityId: opportunity.id,
      lifecycle: 'no_show',
      startAt: '2026-10-22T13:00:00Z',
    });

    await expect(
      loadLatestAppointmentOutcome(AgencyDataSource.manager, opportunity),
    ).resolves.toBe('no_show');
    await expect(
      findOpportunityIdsForAppointment(
        AgencyDataSource.manager,
        scope,
        appointmentId,
      ),
    ).resolves.toEqual([opportunity.id]);
  });

  it('ignores appointments booked before the opportunity existed', async () => {
    const contactId = await insertContact();
    const appointmentId = await insertAppointment({
      contactId,
      lifecycle: 'confirmed',
      startAt: '2026-10-22T13:00:00Z',
    });
    const opportunity = await insertOpportunity(contactId);

    await expect(
      loadLatestAppointmentOutcome(AgencyDataSource.manager, opportunity),
    ).resolves.toBe('none');
    await expect(
      findOpportunityIdsForAppointment(
        AgencyDataSource.manager,
        scope,
        appointmentId,
      ),
    ).resolves.toEqual([]);
  });
});
