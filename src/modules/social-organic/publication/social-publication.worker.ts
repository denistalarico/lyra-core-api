import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { hostname } from 'node:os';
import type {
  SocialPublicationEntity,
  SocialPublicationFailureReason,
} from './entities/social-publication.entity';
import { SocialPublicationRunService } from './social-publication-run.service';
import type {
  SocialPublicationExistenceCheckResult,
  SocialPublicationExistenceChecker,
  SocialPublicationProcessingIdentity,
  SocialPublicationExternalIdentity,
} from './social-publication-run.service';
import {
  nextPublicationAvailableAt,
  shouldRetryPublication,
} from './social-publication-retry';
import { SocialPublicationConfigService } from './social-publication-config.service';

const TICK_MS = 5_000;
const CLAIM_LIMIT = 1;
const RECONCILIATION_POLL_BASE_MS = 60_000;
const RECONCILIATION_POLL_MAX_MS = 15 * 60_000;

export const SOCIAL_PUBLICATION_EXECUTOR = Symbol(
  'SOCIAL_PUBLICATION_EXECUTOR',
);

export interface SocialPublicationExecutor extends SocialPublicationExistenceChecker {
  publish(
    publication: SocialPublicationEntity,
  ): Promise<
    SocialPublicationExternalIdentity | SocialPublicationProcessingIdentity
  >;
}

/** Carries only closed failure taxonomy and safe storage code across the port. */
export class SocialPublicationExecutionError extends Error {
  constructor(
    readonly reason: SocialPublicationFailureReason,
    readonly code: string,
  ) {
    super(code);
    this.name = 'SocialPublicationExecutionError';
  }
}

@Injectable()
export class SocialPublicationWorker {
  private readonly logger = new Logger(SocialPublicationWorker.name);
  private readonly workerId = `${hostname()}:${process.pid}:social-publication`;
  private running = false;

  constructor(
    private readonly runService: SocialPublicationRunService,
    @Optional()
    @Inject(SOCIAL_PUBLICATION_EXECUTOR)
    private readonly executor?: SocialPublicationExecutor,
    private readonly config: SocialPublicationConfigService = new SocialPublicationConfigService(),
  ) {}

  @Interval(TICK_MS)
  async tick(): Promise<void> {
    if (!this.executor || !this.config.enabled || this.running) return;

    this.running = true;
    try {
      await this.runService.recoverStale({ checker: this.executor });
      await this.processDue(CLAIM_LIMIT);
    } catch (error) {
      this.logger.error(
        `Social publication worker cycle failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** Public so unit and PostgreSQL tests can drive a deterministic cycle. */
  async processDue(limit = CLAIM_LIMIT): Promise<number> {
    if (!this.executor || !this.config.enabled) return 0;

    const publications = await this.runService.claim({
      workerId: this.workerId,
      limit,
    });

    for (const publication of publications) {
      await this.processOne(publication);
    }

    return publications.length;
  }

  private async processOne(
    publication: SocialPublicationEntity,
  ): Promise<void> {
    if (!this.executor) return;

    try {
      const identity = await this.executor.publish(publication);
      if (isProcessingIdentity(identity)) {
        if (publication.attempts >= publication.maxAttempts) {
          await this.runService.markFailed({
            publicationId: publication.id,
            lockedBy: this.workerId,
            reason: 'unknown',
            errorCode: 'reconciliation_attempts_exhausted',
          });
          return;
        }

        await this.runService.markProcessing({
          publicationId: publication.id,
          lockedBy: this.workerId,
          externalPublicationId: identity.externalPublicationId,
          providerMetadata: identity.providerMetadata,
          availableAt: nextReconciliationAvailableAt(publication.attempts),
        });
        return;
      }
      await this.runService.markPublished({
        publicationId: publication.id,
        lockedBy: this.workerId,
        identity,
      });
      return;
    } catch (error) {
      await this.settleFailure(publication, error);
    }
  }

  private async settleFailure(
    publication: SocialPublicationEntity,
    error: unknown,
  ): Promise<void> {
    if (!this.executor) return;

    const failure =
      error instanceof SocialPublicationExecutionError
        ? error
        : new SocialPublicationExecutionError(
            'unknown',
            'publication_execution_failed',
          );

    if (failure.code === 'provider_publication_disabled') {
      const availableAt = nextReconciliationAvailableAt(publication.attempts);
      if (publication.externalPublicationId) {
        await this.runService.markProcessing({
          publicationId: publication.id,
          lockedBy: this.workerId,
          externalPublicationId: publication.externalPublicationId,
          availableAt,
        });
      } else {
        await this.runService.reschedule({
          publicationId: publication.id,
          lockedBy: this.workerId,
          reason: 'provider_unavailable',
          errorCode: failure.code,
          availableAt,
        });
      }
      return;
    }
    const retry = shouldRetryPublication({
      reason: failure.reason,
      attempts: publication.attempts,
      maxAttempts: publication.maxAttempts,
    });

    if (!retry) {
      await this.runService.markFailed({
        publicationId: publication.id,
        lockedBy: this.workerId,
        reason: failure.reason,
        errorCode: failure.code,
      });
      return;
    }

    let check: SocialPublicationExistenceCheckResult;
    try {
      check = await this.executor.checkExisting(publication);
    } catch {
      check = { outcome: 'unsafe_to_retry' } as const;
    }

    if (check.outcome === 'published') {
      await this.runService.markPublished({
        publicationId: publication.id,
        lockedBy: this.workerId,
        identity: check,
      });
      return;
    }

    if (check.outcome === 'unsafe_to_retry') {
      await this.runService.markFailed({
        publicationId: publication.id,
        lockedBy: this.workerId,
        reason: 'unknown',
        errorCode: 'retry_safety_unavailable',
      });
      return;
    }

    await this.runService.reschedule({
      publicationId: publication.id,
      lockedBy: this.workerId,
      reason: failure.reason,
      errorCode: failure.code,
      availableAt: nextPublicationAvailableAt({
        reason: failure.reason as Extract<
          SocialPublicationFailureReason,
          'rate_limited' | 'provider_unavailable' | 'unknown'
        >,
        attempts: publication.attempts,
        now: new Date(),
      }),
    });
  }
}

/** Exponential reconciliation polling, bounded so long provider jobs stay observable. */
export function nextReconciliationAvailableAt(
  attempts: number,
  now = new Date(),
): Date {
  const exponent = Math.max(0, Math.trunc(attempts) - 1);
  const delayMs = Math.min(
    RECONCILIATION_POLL_MAX_MS,
    RECONCILIATION_POLL_BASE_MS * 2 ** exponent,
  );
  return new Date(now.getTime() + delayMs);
}

function isProcessingIdentity(
  value:
    | SocialPublicationExternalIdentity
    | SocialPublicationProcessingIdentity,
): value is SocialPublicationProcessingIdentity {
  return 'outcome' in value && value.outcome === 'processing';
}
