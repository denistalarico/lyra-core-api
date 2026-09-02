// src/modules/platform-privacy/services/platform-telemetry-notice-seed.service.ts
//
// Seeds the neutral `platform_product_improvement_v1` consent notice into the
// existing `leadflow_telemetry_consent_notices` table (Lyra Social S1.4.8).
//
// No migration (D-14, S1.4.8 §21): `purpose_key` is a generic `varchar(80)`
// with no CHECK constraint, so a second purpose is new data, not new schema.
// The seeding pattern follows `HelpCenterSeedService`: platform-owned global
// registry content, written idempotently on application bootstrap, never
// blocking boot when the underlying table is not yet migrated.
//
// Deliberate non-behaviours:
//  - it NEVER touches `leadflow_product_improvement_v1` rows (notices or
//    consents). The legacy notice keeps its text, version and hash;
//  - it NEVER rewrites an existing neutral notice row's body/hash. A body
//    change must ship as a new `version`, because rewriting version 1 in
//    place would silently invalidate every acceptance already recorded
//    against that hash (D-4: "nenhuma linha gravada é reescrita").

import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LeadFlowTelemetryConsentNoticeEntity } from '../../leadflow-privacy/entities';
import {
  PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
  PLATFORM_TELEMETRY_NOTICE_CATEGORIES,
  PLATFORM_TELEMETRY_NOTICE_K_ANONYMITY,
  PLATFORM_TELEMETRY_NOTICE_LOCALE,
  PLATFORM_TELEMETRY_NOTICE_RETENTION_DAYS,
  PLATFORM_TELEMETRY_NOTICE_TITLE,
  PLATFORM_TELEMETRY_NOTICE_BODY,
  PLATFORM_TELEMETRY_NOTICE_VERSION,
  platformTelemetryNoticeContentHash,
} from '../platform-telemetry-purpose';

export type PlatformTelemetryNoticeSeedResult =
  | { action: 'created' }
  | { action: 'unchanged' }
  | { action: 'skipped'; reason: string };

@Injectable()
export class PlatformTelemetryNoticeSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PlatformTelemetryNoticeSeedService.name);

  constructor(
    @InjectRepository(LeadFlowTelemetryConsentNoticeEntity, 'agency')
    private readonly notices: Repository<LeadFlowTelemetryConsentNoticeEntity>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.PLATFORM_TELEMETRY_NOTICE_SEED_ON_BOOT === 'false') {
      return;
    }

    try {
      const result = await this.seed();
      if (result.action === 'created') {
        this.logger.log(
          `Seeded neutral telemetry notice ${PLATFORM_PRODUCT_TELEMETRY_PURPOSE} v${PLATFORM_TELEMETRY_NOTICE_VERSION}.`,
        );
      }
    } catch (error) {
      // Never block boot on registry content (e.g. migration not yet applied).
      this.logger.warn(
        `Neutral telemetry notice seed skipped: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Idempotent. Returns `unchanged` when the row already exists — including
   * when its stored body differs from the constant, because rewriting a
   * notice that consents already point at is exactly what D-4 forbids.
   */
  async seed(): Promise<PlatformTelemetryNoticeSeedResult> {
    const existing = await this.notices.findOne({
      where: {
        purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
        version: PLATFORM_TELEMETRY_NOTICE_VERSION,
        locale: PLATFORM_TELEMETRY_NOTICE_LOCALE,
      },
    });

    if (existing) {
      if (existing.contentHash !== platformTelemetryNoticeContentHash()) {
        this.logger.warn(
          `Neutral telemetry notice v${PLATFORM_TELEMETRY_NOTICE_VERSION} exists with a different content hash. ` +
            'Leaving the stored row untouched — a text change must ship as a new version, ' +
            'never as an in-place rewrite of a notice consents already reference.',
        );
      }
      return { action: 'unchanged' };
    }

    await this.notices.save(
      this.notices.create({
        purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
        version: PLATFORM_TELEMETRY_NOTICE_VERSION,
        locale: PLATFORM_TELEMETRY_NOTICE_LOCALE,
        title: PLATFORM_TELEMETRY_NOTICE_TITLE,
        body: PLATFORM_TELEMETRY_NOTICE_BODY,
        contentHash: platformTelemetryNoticeContentHash(),
        categories: [...PLATFORM_TELEMETRY_NOTICE_CATEGORIES],
        retentionDays: PLATFORM_TELEMETRY_NOTICE_RETENTION_DAYS,
        kAnonymityThreshold: PLATFORM_TELEMETRY_NOTICE_K_ANONYMITY,
        // The text is technical and still awaiting legal review. Until this
        // reads 'approved', the neutral purpose accepts NO new opt-in
        // (`requiresApprovedNoticeToOptIn`) and `collectSnapshot` refuses to
        // collect — two independent fences. Withdrawal is never blocked.
        // Flipping this is a legal decision, not a code change.
        legalReviewStatus: 'pending',
        status: 'active',
        effectiveAt: new Date(),
      }),
    );

    return { action: 'created' };
  }
}
