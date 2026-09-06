import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import {
  SocialPublicationEntity,
  SocialPublicationFailureReason,
} from './entities/social-publication.entity';

const AGENCY_CONNECTION = 'agency';

export const SOCIAL_PUBLICATION_LEASE_MS = 10 * 60_000;

export type SocialPublicationExternalIdentity = {
  publishedAt: Date;
  externalPublicationId: string | null;
  externalPermalink: string | null;
  providerMetadata?: Record<string, unknown>;
};

export type SocialPublicationExistenceCheckResult =
  | ({ outcome: 'published' } & SocialPublicationExternalIdentity)
  | { outcome: 'absent' }
  | { outcome: 'unsafe_to_retry' };

/** Provider-aware safety hook; adapters implement this in a later task. */
export interface SocialPublicationExistenceChecker {
  checkExisting(
    publication: SocialPublicationEntity,
  ): Promise<SocialPublicationExistenceCheckResult>;
}

export type SocialPublicationRecoverySummary = {
  published: number;
  requeued: number;
  failed: number;
  skipped: number;
};

/**
 * Rows returned by TypeORM's Postgres driver.
 *
 * SELECT returns `rows`; UPDATE ... RETURNING returns `[rows, rowCount]`.
 */
function returnedRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];

  const [first] = result as unknown[];
  return Array.isArray(first) ? (first as T[]) : (result as T[]);
}

/** All publication queue writes live here so lease ownership is never optional. */
@Injectable()
export class SocialPublicationRunService {
  private readonly logger = new Logger(SocialPublicationRunService.name);

  constructor(
    @InjectRepository(SocialPublicationEntity, AGENCY_CONNECTION)
    private readonly publicationsRepository: Repository<SocialPublicationEntity>,
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
  ) {}

  /** Moves due Lyra-owned schedules into the worker queue. */
  async releaseScheduled(
    input: {
      now?: Date;
      limit?: number;
    } = {},
  ): Promise<number> {
    const now = input.now ?? new Date();
    const limit = Math.max(1, Math.trunc(input.limit ?? 100));
    const result: unknown = await this.dataSource.query(
      `WITH due AS (
         SELECT id
           FROM social_publications
          WHERE status = 'scheduled'
            AND scheduled_at <= $1
          ORDER BY scheduled_at, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT $2
       )
       UPDATE social_publications AS publication
          SET status = 'queued',
              available_at = $1,
              updated_at = now()
         FROM due
        WHERE publication.id = due.id
          AND publication.status = 'scheduled'
       RETURNING publication.id`,
      [now, limit],
    );

    return returnedRows(result).length;
  }

  /** Claims due rows in disjoint batches across workers. */
  async claim(input: {
    workerId: string;
    limit: number;
    now?: Date;
  }): Promise<SocialPublicationEntity[]> {
    const now = input.now ?? new Date();
    const limit = Math.max(1, Math.trunc(input.limit));

    const ids = await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<{ id: string }[]>(
        `SELECT id
           FROM social_publications
          WHERE status = 'queued'
            AND available_at <= $1
          ORDER BY available_at, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT $2`,
        [now, limit],
      );

      if (rows.length === 0) return [];

      const result: unknown = await manager.query(
        `UPDATE social_publications
            SET status = 'processing',
                locked_at = $2,
                locked_by = $3,
                attempts = attempts + 1,
                updated_at = now()
          WHERE id = ANY($1::uuid[])
            AND status = 'queued'
          RETURNING id`,
        [rows.map((row) => row.id), now, input.workerId],
      );

      return returnedRows<{ id: string }>(result).map((row) => row.id);
    });

    if (ids.length === 0) return [];

    return this.publicationsRepository.find({
      where: ids.map((id) => ({ id })),
    });
  }

  async markPublished(input: {
    publicationId: string;
    lockedBy: string;
    identity: SocialPublicationExternalIdentity;
  }): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `UPDATE social_publications
          SET status = 'published',
              published_at = $3,
              external_publication_id = $4,
              external_permalink = $5,
              provider_metadata = $6::jsonb,
              last_error_code = NULL,
              failure_reason = NULL,
              locked_at = NULL,
              locked_by = NULL,
              updated_at = now()
        WHERE id = $1
          AND status = 'processing'
          AND locked_by = $2
        RETURNING id`,
      [
        input.publicationId,
        input.lockedBy,
        input.identity.publishedAt,
        input.identity.externalPublicationId,
        input.identity.externalPermalink,
        JSON.stringify(input.identity.providerMetadata ?? {}),
      ],
    );

    return returnedRows(result).length > 0;
  }

  async markFailed(input: {
    publicationId: string;
    lockedBy: string;
    reason: SocialPublicationFailureReason;
    errorCode: string;
  }): Promise<boolean> {
    return this.finishFailure(input);
  }

  async reschedule(input: {
    publicationId: string;
    lockedBy: string;
    reason: SocialPublicationFailureReason;
    errorCode: string;
    availableAt: Date;
  }): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `UPDATE social_publications
          SET status = 'queued',
              available_at = $3,
              last_error_code = $4,
              failure_reason = $5,
              locked_at = NULL,
              locked_by = NULL,
              updated_at = now()
        WHERE id = $1
          AND status = 'processing'
          AND locked_by = $2
        RETURNING id`,
      [
        input.publicationId,
        input.lockedBy,
        input.availableAt,
        input.errorCode,
        input.reason,
      ],
    );

    return returnedRows(result).length > 0;
  }

  /**
   * Checks the provider before touching every stale lease. A missing or
   * inconclusive check fails closed and never makes the row publishable again.
   */
  async recoverStale(input: {
    checker: SocialPublicationExistenceChecker;
    now?: Date;
    leaseMs?: number;
    limit?: number;
  }): Promise<SocialPublicationRecoverySummary> {
    const now = input.now ?? new Date();
    const expiredBefore = new Date(
      now.getTime() - (input.leaseMs ?? SOCIAL_PUBLICATION_LEASE_MS),
    );
    const stale = await this.publicationsRepository.find({
      where: { status: 'processing', lockedAt: LessThan(expiredBefore) },
      order: { lockedAt: 'ASC' },
      take: Math.max(1, Math.trunc(input.limit ?? 20)),
    });
    const summary: SocialPublicationRecoverySummary = {
      published: 0,
      requeued: 0,
      failed: 0,
      skipped: 0,
    };

    for (const publication of stale) {
      if (!publication.lockedBy || !publication.lockedAt) {
        summary.skipped += 1;
        continue;
      }

      let check: SocialPublicationExistenceCheckResult;

      try {
        check = await input.checker.checkExisting(publication);
      } catch {
        summary.skipped += 1;
        continue;
      }

      if (check.outcome === 'published') {
        if (
          await this.finishRecoveredPublished(
            publication,
            check,
            publication.lockedBy,
          )
        ) {
          summary.published += 1;
        } else {
          summary.skipped += 1;
        }
        continue;
      }

      if (
        check.outcome === 'absent' &&
        publication.attempts < publication.maxAttempts
      ) {
        if (
          await this.requeueRecovered(publication, publication.lockedBy, now)
        ) {
          summary.requeued += 1;
        } else {
          summary.skipped += 1;
        }
        continue;
      }

      if (
        await this.finishFailure({
          publicationId: publication.id,
          lockedBy: publication.lockedBy,
          reason: 'unknown',
          errorCode:
            check.outcome === 'unsafe_to_retry'
              ? 'retry_safety_unavailable'
              : 'lease_attempts_exhausted',
          expectedLockedAt: publication.lockedAt,
        })
      ) {
        summary.failed += 1;
      } else {
        summary.skipped += 1;
      }
    }

    if (summary.published + summary.requeued + summary.failed > 0) {
      this.logger.warn(
        `Recovered stale Social publications: ${JSON.stringify(summary)}`,
      );
    }

    return summary;
  }

  private async requeueRecovered(
    publication: SocialPublicationEntity,
    lockedBy: string,
    now: Date,
  ): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `UPDATE social_publications
          SET status = 'queued',
              available_at = $4,
              last_error_code = 'lease_expired',
              failure_reason = 'unknown',
              locked_at = NULL,
              locked_by = NULL,
              updated_at = now()
        WHERE id = $1
          AND status = 'processing'
          AND locked_by = $2
          AND locked_at = $3
        RETURNING id`,
      [publication.id, lockedBy, publication.lockedAt, now],
    );

    return returnedRows(result).length > 0;
  }

  private async finishRecoveredPublished(
    publication: SocialPublicationEntity,
    identity: SocialPublicationExternalIdentity,
    lockedBy: string,
  ): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `UPDATE social_publications
          SET status = 'published',
              published_at = $4,
              external_publication_id = $5,
              external_permalink = $6,
              provider_metadata = $7::jsonb,
              last_error_code = NULL,
              failure_reason = NULL,
              locked_at = NULL,
              locked_by = NULL,
              updated_at = now()
        WHERE id = $1
          AND status = 'processing'
          AND locked_by = $2
          AND locked_at = $3
        RETURNING id`,
      [
        publication.id,
        lockedBy,
        publication.lockedAt,
        identity.publishedAt,
        identity.externalPublicationId,
        identity.externalPermalink,
        JSON.stringify(identity.providerMetadata ?? {}),
      ],
    );

    return returnedRows(result).length > 0;
  }

  private async finishFailure(input: {
    publicationId: string;
    lockedBy: string;
    reason: SocialPublicationFailureReason;
    errorCode: string;
    expectedLockedAt?: Date;
  }): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `UPDATE social_publications
          SET status = 'failed',
              last_error_code = $3,
              failure_reason = $4,
              locked_at = NULL,
              locked_by = NULL,
              updated_at = now()
        WHERE id = $1
          AND status = 'processing'
          AND locked_by = $2
          ${input.expectedLockedAt ? 'AND locked_at = $5' : ''}
        RETURNING id`,
      [
        input.publicationId,
        input.lockedBy,
        input.errorCode,
        input.reason,
        ...(input.expectedLockedAt ? [input.expectedLockedAt] : []),
      ],
    );

    return returnedRows(result).length > 0;
  }
}
