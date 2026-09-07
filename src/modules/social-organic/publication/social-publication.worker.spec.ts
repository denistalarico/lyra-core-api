import type { SocialPublicationEntity } from './entities/social-publication.entity';
import type { SocialPublicationRunService } from './social-publication-run.service';
import {
  SocialPublicationExecutionError,
  SocialPublicationExecutor,
  SocialPublicationWorker,
  nextReconciliationAvailableAt,
} from './social-publication.worker';
import type { SocialPublicationConfigService } from './social-publication-config.service';

function createHarness(input: {
  error: Error;
  attempts?: number;
  checkOutcome?: 'absent' | 'published' | 'unsafe_to_retry';
  enabled?: boolean;
}) {
  const row = {
    id: 'publication-a',
    attempts: input.attempts ?? 1,
    maxAttempts: 5,
  } as SocialPublicationEntity;
  const runService = {
    claim: jest.fn(() => Promise.resolve([row])),
    markPublished: jest.fn(() => Promise.resolve(true)),
    markProcessing: jest.fn(() => Promise.resolve(true)),
    markFailed: jest.fn(() => Promise.resolve(true)),
    reschedule: jest.fn(() => Promise.resolve(true)),
    recoverStale: jest.fn(() => Promise.resolve({})),
  };
  const executor = {
    publish: jest.fn(() => Promise.reject(input.error)),
    checkExisting: jest.fn(() =>
      Promise.resolve(
        input.checkOutcome === 'published'
          ? {
              outcome: 'published' as const,
              publishedAt: new Date(),
              externalPublicationId: 'external-a',
              externalPermalink: null,
            }
          : { outcome: input.checkOutcome ?? ('absent' as const) },
      ),
    ),
  };
  const worker = new SocialPublicationWorker(
    runService as unknown as SocialPublicationRunService,
    executor as SocialPublicationExecutor,
    {
      get enabled() {
        return input.enabled ?? true;
      },
    } as SocialPublicationConfigService,
  );

  return { worker, runService, executor };
}

describe('SocialPublicationWorker', () => {
  it('backs off reconciliation polls exponentially with a bounded ceiling', () => {
    const now = new Date('2026-09-07T12:00:00.000Z');

    expect(nextReconciliationAvailableAt(1, now).getTime()).toBe(
      now.getTime() + 60_000,
    );
    expect(nextReconciliationAvailableAt(3, now).getTime()).toBe(
      now.getTime() + 4 * 60_000,
    );
    expect(nextReconciliationAvailableAt(99, now).getTime()).toBe(
      now.getTime() + 15 * 60_000,
    );
  });

  it('does not requeue a non-retryable failure', async () => {
    const { worker, runService, executor } = createHarness({
      error: new SocialPublicationExecutionError(
        'payload_invalid',
        'caption_invalid',
      ),
    });

    await worker.processDue();

    expect(runService.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'payload_invalid' }),
    );
    expect(runService.reschedule).not.toHaveBeenCalled();
    expect(executor.checkExisting).not.toHaveBeenCalled();
  });

  it('persists an asynchronous provider identity and schedules reconciliation without marking published', async () => {
    const row = {
      id: 'publication-a',
      attempts: 1,
      maxAttempts: 5,
    } as SocialPublicationEntity;
    const runService = {
      claim: jest.fn(() => Promise.resolve([row])),
      markPublished: jest.fn(),
      markProcessing: jest.fn(() => Promise.resolve(true)),
      markFailed: jest.fn(),
      reschedule: jest.fn(),
    };
    const executor = {
      publish: jest.fn(() =>
        Promise.resolve({
          outcome: 'processing' as const,
          externalPublicationId: 'ig-container:container-1',
          providerMetadata: { phase: 'container_processing' },
        }),
      ),
      checkExisting: jest.fn(),
    };
    const worker = new SocialPublicationWorker(
      runService as unknown as SocialPublicationRunService,
      executor,
      { enabled: true } as SocialPublicationConfigService,
    );

    await worker.processDue();

    expect(runService.markProcessing).toHaveBeenCalledWith(
      expect.objectContaining({
        externalPublicationId: 'ig-container:container-1',
      }),
    );
    expect(runService.markPublished).not.toHaveBeenCalled();
    expect(runService.markFailed).not.toHaveBeenCalled();
  });

  it('reschedules a provider-disabled row without an existence check or external retry', async () => {
    const { worker, runService, executor } = createHarness({
      error: new SocialPublicationExecutionError(
        'provider_unavailable',
        'provider_publication_disabled',
      ),
    });

    await worker.processDue();

    expect(runService.reschedule).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'provider_publication_disabled',
      }),
    );
    expect(executor.checkExisting).not.toHaveBeenCalled();
  });

  it('checks existence before requeueing a retryable failure', async () => {
    const { worker, runService, executor } = createHarness({
      error: new SocialPublicationExecutionError(
        'provider_unavailable',
        'provider_unavailable',
      ),
    });

    await worker.processDue();

    expect(executor.checkExisting).toHaveBeenCalledTimes(1);
    expect(runService.reschedule).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'provider_unavailable' }),
    );
  });

  it('records a recovered provider success instead of requeueing', async () => {
    const { worker, runService } = createHarness({
      error: new SocialPublicationExecutionError('unknown', 'response_lost'),
      checkOutcome: 'published',
    });

    await worker.processDue();

    expect(runService.markPublished).toHaveBeenCalledTimes(1);
    expect(runService.reschedule).not.toHaveBeenCalled();
  });

  it('fails closed when a provider cannot make retry safe', async () => {
    const { worker, runService } = createHarness({
      error: new SocialPublicationExecutionError('unknown', 'response_lost'),
      checkOutcome: 'unsafe_to_retry',
    });

    await worker.processDue();

    expect(runService.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'unknown',
        errorCode: 'retry_safety_unavailable',
      }),
    );
    expect(runService.reschedule).not.toHaveBeenCalled();
  });

  it('does not retry unknown more than once', async () => {
    const { worker, runService, executor } = createHarness({
      error: new SocialPublicationExecutionError('unknown', 'response_lost'),
      attempts: 2,
    });

    await worker.processDue();

    expect(runService.markFailed).toHaveBeenCalledTimes(1);
    expect(runService.reschedule).not.toHaveBeenCalled();
    expect(executor.checkExisting).not.toHaveBeenCalled();
  });

  it('does nothing until an executor is registered', async () => {
    const runService = { claim: jest.fn() };
    const worker = new SocialPublicationWorker(
      runService as unknown as SocialPublicationRunService,
    );

    await expect(worker.processDue()).resolves.toBe(0);
    expect(runService.claim).not.toHaveBeenCalled();
  });

  it('does not recover or lease while publishing is globally disabled', async () => {
    const { worker, runService, executor } = createHarness({
      error: new SocialPublicationExecutionError('unknown', 'not_reached'),
      enabled: false,
    });

    await expect(worker.tick()).resolves.toBeUndefined();
    await expect(worker.processDue()).resolves.toBe(0);

    expect(runService.recoverStale).not.toHaveBeenCalled();
    expect(runService.claim).not.toHaveBeenCalled();
    expect(executor.publish).not.toHaveBeenCalled();
  });
});
