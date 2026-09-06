import type { DataSource, Repository } from 'typeorm';
import type { SocialPublicationEntity } from './entities/social-publication.entity';
import { SocialPublicationRunService } from './social-publication-run.service';

const NOW = new Date('2026-09-06T12:00:00.000Z');
const LOCKED_AT = new Date('2026-09-06T11:00:00.000Z');

function publication(
  overrides: Partial<SocialPublicationEntity> = {},
): SocialPublicationEntity {
  return {
    id: 'publication-a',
    status: 'processing',
    attempts: 1,
    maxAttempts: 5,
    lockedBy: 'worker-a',
    lockedAt: LOCKED_AT,
    ...overrides,
  } as SocialPublicationEntity;
}

function harness(
  input: {
    queryResults?: unknown[];
    found?: SocialPublicationEntity[];
  } = {},
) {
  const results = [...(input.queryResults ?? [])];
  const repository = {
    find: jest.fn(() => Promise.resolve(input.found ?? [])),
  };
  const query = jest.fn<Promise<unknown>, [string, unknown[]?]>(() =>
    Promise.resolve(results.shift() ?? []),
  );
  const dataSource = {
    query,
    transaction: jest.fn(),
  };
  const service = new SocialPublicationRunService(
    repository as unknown as Repository<SocialPublicationEntity>,
    dataSource as unknown as DataSource,
  );

  return { service, repository, dataSource };
}

describe('SocialPublicationRunService', () => {
  it('reads [rows, rowCount] correctly when releasing schedules', async () => {
    const { service } = harness({ queryResults: [[[{}], 1]] });

    await expect(service.releaseScheduled({ now: NOW })).resolves.toBe(1);
  });

  it('treats an empty UPDATE RETURNING pair as a rejected old-worker write', async () => {
    const { service, dataSource } = harness({ queryResults: [[[], 0]] });

    await expect(
      service.markPublished({
        publicationId: 'publication-a',
        lockedBy: 'worker-expired',
        identity: {
          publishedAt: NOW,
          externalPublicationId: 'external-a',
          externalPermalink: null,
        },
      }),
    ).resolves.toBe(false);

    expect(dataSource.query.mock.calls[0][0]).toContain('locked_by = $2');
  });

  it('runs the existence check before requeueing a stale lease', async () => {
    const row = publication();
    const { service, dataSource } = harness({
      found: [row],
      queryResults: [[[{ id: row.id }], 1]],
    });
    const checker = {
      checkExisting: jest.fn(() =>
        Promise.resolve({ outcome: 'absent' as const }),
      ),
    };

    await expect(service.recoverStale({ checker, now: NOW })).resolves.toEqual({
      published: 0,
      requeued: 1,
      failed: 0,
      skipped: 0,
    });

    expect(checker.checkExisting).toHaveBeenCalledWith(row);
    expect(checker.checkExisting.mock.invocationCallOrder[0]).toBeLessThan(
      dataSource.query.mock.invocationCallOrder[0],
    );
    expect(dataSource.query.mock.calls[0][0]).toContain('locked_by = $2');
    expect(dataSource.query.mock.calls[0][0]).toContain('locked_at = $3');
  });

  it('fails closed when a stale publication cannot be checked safely', async () => {
    const row = publication();
    const { service, dataSource } = harness({
      found: [row],
      queryResults: [[[{ id: row.id }], 1]],
    });

    await expect(
      service.recoverStale({
        checker: {
          checkExisting: () =>
            Promise.resolve({ outcome: 'unsafe_to_retry' as const }),
        },
        now: NOW,
      }),
    ).resolves.toEqual({ published: 0, requeued: 0, failed: 1, skipped: 0 });

    expect(dataSource.query.mock.calls[0][0]).toContain("status = 'failed'");
    expect(dataSource.query.mock.calls[0][0]).toContain('locked_by = $2');
    expect(dataSource.query.mock.calls[0][0]).toContain('locked_at = $5');
  });

  it('does not touch a stale lease when the safety hook throws', async () => {
    const { service, dataSource } = harness({ found: [publication()] });

    await expect(
      service.recoverStale({
        checker: {
          checkExisting: () => Promise.reject(new Error('provider down')),
        },
        now: NOW,
      }),
    ).resolves.toEqual({ published: 0, requeued: 0, failed: 0, skipped: 1 });

    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it.each(['markFailed', 'reschedule'] as const)(
    'guards %s with the current lease holder',
    async (method) => {
      const { service, dataSource } = harness({
        queryResults: [[[{ id: 'publication-a' }], 1]],
      });

      if (method === 'markFailed') {
        await service.markFailed({
          publicationId: 'publication-a',
          lockedBy: 'worker-a',
          reason: 'payload_invalid',
          errorCode: 'invalid_caption',
        });
      } else {
        await service.reschedule({
          publicationId: 'publication-a',
          lockedBy: 'worker-a',
          reason: 'provider_unavailable',
          errorCode: 'provider_unavailable',
          availableAt: NOW,
        });
      }

      expect(dataSource.query.mock.calls[0][0]).toContain('locked_by = $2');
    },
  );
});
