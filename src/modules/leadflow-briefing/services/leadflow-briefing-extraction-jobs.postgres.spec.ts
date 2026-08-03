import { randomUUID } from 'node:crypto';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import {
  LeadFlowBriefingExtractionJobEntity,
  LeadFlowBriefingSourceEntity,
  LeadFlowBriefingSourceVersionEntity,
} from '../entities';
import { LeadFlowBriefingJobStatus } from '../enums/leadflow-briefing-job-status.enum';
import { LeadFlowBriefingSourceKind } from '../enums/leadflow-briefing-source-kind.enum';
import { LeadFlowBriefingExtractionJobService } from './leadflow-briefing-extraction-job.service';
import { LeadFlowBriefingJobStateMachine } from './leadflow-briefing-job-state-machine';
import { LeadFlowBriefingSourceService } from './leadflow-briefing-source.service';

const run =
  process.env.INBOX_PG_INTEGRATION === 'true' ? describe : describe.skip;

run('LeadFlow Briefing extraction jobs PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  let jobService: LeadFlowBriefingExtractionJobService;
  let sourceService: LeadFlowBriefingSourceService;
  let settingsId: string;
  let sourceId: string;
  let sourceVersionId: string;

  const ctx = () => ({ tenantId, workspaceId, userId: randomUUID() });

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    jobService = new LeadFlowBriefingExtractionJobService(
      AgencyDataSource,
      new LeadFlowBriefingJobStateMachine(),
    );
    sourceService = new LeadFlowBriefingSourceService(AgencyDataSource);

    const settings = await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).save({
      tenantId,
      workspaceId,
      contextType: LeadFlowSettingsContextType.Agency,
      businessModeKey: LeadFlowBusinessMode.AgencyServices,
    });
    settingsId = settings.id;

    const source = await sourceService.createSource(ctx(), {
      settingsId,
      contextType: LeadFlowSettingsContextType.Agency,
      agencyClientId: null,
      kind: LeadFlowBriefingSourceKind.Upload,
      label: 'Source for job tests',
      createdById: null,
    });
    sourceId = source.id;

    const version = await sourceService.createSourceVersion(ctx(), {
      sourceId,
      kind: LeadFlowBriefingSourceKind.Upload,
      checksum: 'job-tests-checksum',
      createdById: null,
    });
    sourceVersionId = version.id;
  });

  afterAll(async () => {
    await AgencyDataSource.getRepository(LeadFlowBriefingExtractionJobEntity).delete({
      tenantId,
    });
    await AgencyDataSource.getRepository(LeadFlowBriefingSourceVersionEntity).delete({
      tenantId,
    });
    await AgencyDataSource.getRepository(LeadFlowBriefingSourceEntity).delete({ tenantId });
    await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).delete({ tenantId });
  });

  it('enqueues a job idempotently: the same (source_version_id, job_kind) twice returns the same row', async () => {
    const first = await jobService.enqueueJob(ctx(), {
      settingsId,
      sourceId,
      sourceVersionId,
      createdById: null,
    });
    const second = await jobService.enqueueJob(ctx(), {
      settingsId,
      sourceId,
      sourceVersionId,
      createdById: null,
    });

    expect(second.id).toBe(first.id);

    const count = await AgencyDataSource.getRepository(LeadFlowBriefingExtractionJobEntity).count({
      where: { tenantId, workspaceId, sourceVersionId },
    });
    expect(count).toBe(1);
  });

  it('rejects a direct duplicate idempotency-key insert at the DB level', async () => {
    const repo = AgencyDataSource.getRepository(LeadFlowBriefingExtractionJobEntity);
    const key = `manual-dup-${randomUUID()}`;
    await repo.save(
      repo.create({
        tenantId,
        workspaceId,
        settingsId,
        sourceId,
        sourceVersionId,
        idempotencyKey: key,
      }),
    );

    await expect(
      repo.save(
        repo.create({
          tenantId,
          workspaceId,
          settingsId,
          sourceId,
          sourceVersionId,
          idempotencyKey: key,
        }),
      ),
    ).rejects.toThrow();
  });

  it('walks a job through queued -> processing -> succeeded', async () => {
    const enqueued = await jobService.enqueueJob(ctx(), {
      settingsId,
      sourceId,
      sourceVersionId,
      jobKind: `lifecycle-${randomUUID()}`,
      createdById: null,
    });

    const processing = await jobService.transitionJob(
      ctx(),
      enqueued.id,
      LeadFlowBriefingJobStatus.Processing,
    );
    expect(processing.status).toBe(LeadFlowBriefingJobStatus.Processing);
    expect(processing.attempts).toBe(1);

    const succeeded = await jobService.transitionJob(
      ctx(),
      enqueued.id,
      LeadFlowBriefingJobStatus.Succeeded,
    );
    expect(succeeded.status).toBe(LeadFlowBriefingJobStatus.Succeeded);
  });

  it('rejects an illegal transition (queued -> succeeded)', async () => {
    const enqueued = await jobService.enqueueJob(ctx(), {
      settingsId,
      sourceId,
      sourceVersionId,
      jobKind: `illegal-${randomUUID()}`,
      createdById: null,
    });

    await expect(
      jobService.transitionJob(ctx(), enqueued.id, LeadFlowBriefingJobStatus.Succeeded),
    ).rejects.toThrow();
  });

  it('claim query only returns queued jobs that are due and unlocked', async () => {
    const due = await jobService.enqueueJob(ctx(), {
      settingsId,
      sourceId,
      sourceVersionId,
      jobKind: `claimable-${randomUUID()}`,
      createdById: null,
    });
    const locked = await jobService.enqueueJob(ctx(), {
      settingsId,
      sourceId,
      sourceVersionId,
      jobKind: `locked-${randomUUID()}`,
      createdById: null,
    });
    await jobService.transitionJob(ctx(), locked.id, LeadFlowBriefingJobStatus.Processing);

    const repo = AgencyDataSource.getRepository(LeadFlowBriefingExtractionJobEntity);
    const claimable = await jobService.findClaimableJobs(repo);
    const claimableIds = claimable
      .filter((job) => job.tenantId === tenantId)
      .map((job) => job.id);

    expect(claimableIds).toContain(due.id);
    expect(claimableIds).not.toContain(locked.id);
  });
});
