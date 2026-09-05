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
  PLATFORM_TELEMETRY_NOTICE_V1_CATEGORIES,
  PLATFORM_TELEMETRY_NOTICE_V1_TITLE,
  PLATFORM_TELEMETRY_NOTICE_V1_BODY,
  platformTelemetryNoticeContentHash,
  platformTelemetryNoticeV1ContentHash,
} from '../platform-telemetry-purpose';

const V1_VERSION = 1;
const V1_RETENTION_DAYS = 90;
const V1_K_ANONYMITY = 5;

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
      const v1 = await this.seedV1();
      if (v1.action === 'created') {
        this.logger.log(
          `Seeded neutral telemetry notice ${PLATFORM_PRODUCT_TELEMETRY_PURPOSE} v${V1_VERSION}.`,
        );
      }

      const current = await this.seed();
      if (current.action === 'created') {
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
   *
   * Seeds the CURRENT version — `PLATFORM_TELEMETRY_NOTICE_VERSION` (2, as of
   * I6.2) — never the original v1. `seedV1` below is what keeps v1 present for
   * a deployment that has never booted this service before; it is a distinct
   * method rather than a loop over versions so that "the version this seeds"
   * is never ambiguous from the call site.
   */
  async seed(): Promise<PlatformTelemetryNoticeSeedResult> {
    return this.seedVersion({
      version: PLATFORM_TELEMETRY_NOTICE_VERSION,
      title: PLATFORM_TELEMETRY_NOTICE_TITLE,
      body: PLATFORM_TELEMETRY_NOTICE_BODY,
      contentHash: platformTelemetryNoticeContentHash(),
      categories: PLATFORM_TELEMETRY_NOTICE_CATEGORIES,
      retentionDays: PLATFORM_TELEMETRY_NOTICE_RETENTION_DAYS,
      kAnonymityThreshold: PLATFORM_TELEMETRY_NOTICE_K_ANONYMITY,
      // I6.2: live enough for an explicit user opt-in, not yet formally
      // cleared by legal. `isNoticeClearedForConsent` treats this exactly
      // like `'approved'` for both `optIn` and `collectSnapshot` — the
      // platform gate (`LEADFLOW_PRODUCT_TELEMETRY_ENABLED`), which stays
      // off, is what actually keeps production from collecting before formal
      // sign-off. Flipping this to `'approved'` remains a legal decision,
      // never a code change.
      legalReviewStatus: 'provisional',
    });
  }

  /**
   * Seeds the original version 1 row, exactly as migration 1788200000000's
   * sibling would have written it, so a fresh environment still has it present
   * as history even though it is no longer the version anyone resolves
   * against for a new acceptance.
   */
  private async seedV1(): Promise<PlatformTelemetryNoticeSeedResult> {
    return this.seedVersion({
      version: V1_VERSION,
      title: PLATFORM_TELEMETRY_NOTICE_V1_TITLE,
      body: PLATFORM_TELEMETRY_NOTICE_V1_BODY,
      contentHash: platformTelemetryNoticeV1ContentHash(),
      categories: PLATFORM_TELEMETRY_NOTICE_V1_CATEGORIES,
      retentionDays: V1_RETENTION_DAYS,
      kAnonymityThreshold: V1_K_ANONYMITY,
      legalReviewStatus: 'pending',
    });
  }

  private async seedVersion(input: {
    version: number;
    title: string;
    body: string;
    contentHash: string;
    categories: readonly string[];
    retentionDays: number;
    kAnonymityThreshold: number;
    legalReviewStatus: 'pending' | 'provisional' | 'approved' | 'rejected';
  }): Promise<PlatformTelemetryNoticeSeedResult> {
    const existing = await this.notices.findOne({
      where: {
        purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
        version: input.version,
        locale: PLATFORM_TELEMETRY_NOTICE_LOCALE,
      },
    });

    if (existing) {
      if (existing.contentHash !== input.contentHash) {
        this.logger.warn(
          `Neutral telemetry notice v${input.version} exists with a different content hash. ` +
            'Leaving the stored row untouched — a text change must ship as a new version, ' +
            'never as an in-place rewrite of a notice consents already reference.',
        );
      }
      return { action: 'unchanged' };
    }

    await this.notices.save(
      this.notices.create({
        purposeKey: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
        version: input.version,
        locale: PLATFORM_TELEMETRY_NOTICE_LOCALE,
        title: input.title,
        body: input.body,
        contentHash: input.contentHash,
        categories: [...input.categories],
        retentionDays: input.retentionDays,
        kAnonymityThreshold: input.kAnonymityThreshold,
        legalReviewStatus: input.legalReviewStatus,
        status: 'active',
        effectiveAt: new Date(),
      }),
    );

    return { action: 'created' };
  }
}
