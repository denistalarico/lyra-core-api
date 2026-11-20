import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SocialAdCredentialError } from '../../social-integrations/credentials/social-ad-credential.error';
import { SocialAdCredentialResolver } from '../../social-integrations/credentials/social-ad-credential.resolver';
import type { ResolvedAdCredential } from '../../social-integrations/credentials/resolved-ad-credential';
import { GoogleAdsReaderService } from '../../social-integrations/services/google-ads-reader.service';
import { SocialAdConnectionService } from '../../social-integrations/services/social-ad-connection.service';
import { GoogleAdsError } from '../../social-integrations/sync/google-ads-error';
import {
  currentDayIn,
  currentHourIn,
  shiftDay,
} from '../../social-integrations/sync/insights-window';
import { FormEntity } from '../entities/form.entity';
import {
  type ParsedGoogleAdsLead,
  parseGoogleAdsApiLead,
} from '../google-ads-lead.normalizer';
import {
  DEFAULT_FORM_GOOGLE_ADS_LEADS,
  type FormGoogleAdsLeads,
  type FormGoogleAdsLeadsImportResult,
  type FormGoogleAdsLeadsImportSummary,
} from '../forms.types';
import { FormGoogleAdsLeadsService } from './form-google-ads-leads.service';
import { FormLeadIngestionService } from './form-lead-ingestion.service';
import { FormsAddonService } from './forms-addon.service';

/** Days asked from the API (§5.5); `oldestSubmittedAt` shows how far it really went. */
const LOOKBACK_DAYS = 30;
/** D-L3 layer 2: same click (`gclid`) on the same form within this window = same lead. */
const GCLID_WINDOW_DAYS = 30;
/** Daily reconciliation hour, in the ad account's time zone. */
const RECONCILE_HOUR = 5;

type ImportTrigger = 'manual' | 'daily';

export type FormGoogleAdsLeadsConnectionOption = {
  id: string;
  accountName: string | null;
  maskedAccountId: string | null;
  status: string;
  timezone: string | null;
};

function scopeOf(form: FormEntity) {
  return {
    tenantId: form.tenantId,
    workspaceId: form.workspaceId,
    agencyClientId: form.agencyClientId ?? null,
    companyContextId: form.companyContextId ?? null,
  };
}

function settingsOf(form: FormEntity): FormGoogleAdsLeads {
  return { ...DEFAULT_FORM_GOOGLE_ADS_LEADS, ...(form.googleAdsLeads ?? {}) };
}

/**
 * GL2: earlier Google Ads leads through the API (`lead_form_submission_data`),
 * plus a daily reconciliation at 05:00 of the account (one operation), both
 * into the same `form_submissions` → CRM path as the webhook (D-L1).
 *
 * The connection must share the form's exact scope (tenant, workspace, client
 * and company context). Lead rows carry PII: only ids, counts and error codes
 * are logged or stored in `google_ads_leads`.
 */
@Injectable()
export class FormGoogleAdsLeadsImportService {
  private readonly logger = new Logger(FormGoogleAdsLeadsImportService.name);

  constructor(
    @InjectRepository(FormEntity, 'agency')
    private readonly forms: Repository<FormEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly connections: SocialAdConnectionService,
    private readonly credentials: SocialAdCredentialResolver,
    private readonly reader: GoogleAdsReaderService,
    private readonly leads: FormGoogleAdsLeadsService,
    private readonly ingestion: FormLeadIngestionService,
    private readonly addon: FormsAddonService,
  ) {}

  /** Google Ads connections the form may import from (same scope). */
  async listConnections(
    form: FormEntity,
  ): Promise<FormGoogleAdsLeadsConnectionOption[]> {
    const connections = await this.connections.list(scopeOf(form));
    return connections
      .filter((connection) => connection.provider === 'google_ads')
      .map((connection) => ({
        id: connection.id,
        accountName: connection.accountName,
        maskedAccountId: connection.maskedAccountId,
        status: connection.status,
        timezone: connection.timezone,
      }));
  }

  /** 409 `import_in_progress` · 422 `connection_not_google_ads` (§5.4). */
  async importLeads(
    form: FormEntity,
    connectionId: string,
    trigger: ImportTrigger = 'manual',
  ): Promise<FormGoogleAdsLeadsImportResult> {
    if (
      form.type !== 'lead_capture' ||
      form.status !== 'active' ||
      form.googleAdsLeads?.enabled !== true
    )
      throw new UnprocessableEntityException('google_ads_leads_disabled');

    const connection = (await this.connections.list(scopeOf(form))).find(
      (candidate) => candidate.id === connectionId,
    );
    if (!connection) throw new NotFoundException('connection_not_found');
    if (connection.provider !== 'google_ads')
      throw new UnprocessableEntityException('connection_not_google_ads');

    // One import per form at a time (webhook races are D-L3's ON CONFLICT).
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    const lockKey = `forms_google_ads_import:${form.id}`;
    try {
      const [{ locked }] = (await runner.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [lockKey],
      )) as Array<{ locked: boolean }>;
      if (!locked) throw new ConflictException('import_in_progress');
      try {
        return await this.run(form, connectionId, trigger);
      } finally {
        await runner.query(
          'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
          [lockKey],
        );
      }
    } finally {
      await runner.release();
    }
  }

  /** Every hour; each form runs once, in the 05:00 hour of its account. */
  @Cron('0 10 * * * *', {
    name: 'forms-google-ads-leads-reconcile',
    waitForCompletion: true,
  })
  async reconcileAll(now: Date = new Date()): Promise<void> {
    if (process.env.FORMS_GOOGLE_ADS_LEADS_ENABLED === 'false') return;
    const forms = await this.forms
      .createQueryBuilder('f')
      .where("f.status = 'active' AND f.type = 'lead_capture'")
      .andWhere("f.googleAdsLeads ->> 'enabled' = 'true'")
      .andWhere("f.googleAdsLeads ->> 'importConnectionId' IS NOT NULL")
      .getMany();

    for (const form of forms) {
      try {
        const settings = settingsOf(form);
        const connectionId = settings.importConnectionId;
        if (!connectionId) continue;
        if (!(await this.addon.isEnabled(form.tenantId, form.workspaceId)))
          continue;
        const connection = (await this.connections.list(scopeOf(form))).find(
          (candidate) =>
            candidate.id === connectionId &&
            candidate.provider === 'google_ads',
        );
        const timezone = connection?.timezone;
        if (!timezone) continue;
        if (currentHourIn(timezone, now) !== RECONCILE_HOUR) continue;
        if (settings.lastReconciledDay === currentDayIn(timezone, now))
          continue;
        await this.importLeads(form, connectionId, 'daily');
      } catch (error) {
        // Another instance holds the lock, or the failure is already recorded.
        if (error instanceof ConflictException) continue;
        this.logger.warn(
          `Google Ads daily reconciliation of form ${form.id} failed (${this.errorCode(error)}).`,
        );
      }
    }
  }

  private async run(
    form: FormEntity,
    connectionId: string,
    trigger: ImportTrigger,
  ): Promise<FormGoogleAdsLeadsImportResult> {
    let credential: ResolvedAdCredential;
    let rows: unknown[];
    try {
      credential = await this.credentials.resolve({
        connectionId,
        ...scopeOf(form),
      });
      if (credential.provider !== 'google_ads')
        throw new UnprocessableEntityException('connection_not_google_ads');
      const since = shiftDay(currentDayIn(credential.timezone), -LOOKBACK_DAYS);
      rows = (await this.reader.readLeadSubmissions(credential, since)).rows;
    } catch (error) {
      throw await this.failed(form.id, error);
    }

    const parsed = rows.map((row) => parseGoogleAdsApiLead(row));
    const belongs = await this.formFilter(form, parsed);
    const summary: Omit<FormGoogleAdsLeadsImportSummary, 'at' | 'trigger'> = {
      read: rows.length,
      created: 0,
      duplicates: 0,
      skipped: 0,
      oldestSubmittedAt: null,
      failed: 0,
      idMatchesWebhook: 0,
      idDiffersFromWebhook: 0,
    };

    for (const lead of parsed) {
      if (
        lead?.submittedAt &&
        (!summary.oldestSubmittedAt ||
          lead.submittedAt < summary.oldestSubmittedAt)
      )
        summary.oldestSubmittedAt = lead.submittedAt;
      if (!lead || !belongs(lead)) {
        summary.skipped += 1;
        continue;
      }

      const existing = await this.findExisting(form.id, lead);
      if (existing) {
        summary.duplicates += 1;
        if (existing.origin !== 'api') {
          if (existing.externalLeadId === lead.leadId)
            summary.idMatchesWebhook += 1;
          else summary.idDiffersFromWebhook += 1;
        }
        continue;
      }

      // The webhook may win the race between the lookup and the insert.
      const submission = await this.leads.store(form, lead, 'api');
      if (!submission) {
        summary.duplicates += 1;
        continue;
      }
      summary.created += 1;
      try {
        const processed = await this.ingestion.process(form, submission);
        if (processed.status === 'failed') summary.failed += 1;
      } catch (error) {
        summary.failed += 1;
        this.logger.warn(
          `Imported Google Ads lead ${submission.id} of form ${form.id} not processed (${this.errorCode(error)}).`,
        );
      }
    }

    const record: FormGoogleAdsLeadsImportSummary = {
      ...summary,
      at: new Date().toISOString(),
      trigger,
    };
    await this.patchSettings(form.id, {
      importConnectionId: connectionId,
      lastImport: record,
      lastImportError: null,
      ...(trigger === 'daily'
        ? { lastReconciledDay: currentDayIn(credential.timezone) }
        : {}),
    });
    this.logger.log(
      `Google Ads import (${trigger}) of form ${form.id}: read ${summary.read}, created ${summary.created}, duplicates ${summary.duplicates}, skipped ${summary.skipped}, failed ${summary.failed}, id=webhook ${summary.idMatchesWebhook}, id≠webhook ${summary.idDiffersFromWebhook}.`,
    );

    return {
      read: summary.read,
      created: summary.created,
      duplicates: summary.duplicates,
      skipped: summary.skipped,
      oldestSubmittedAt: summary.oldestSubmittedAt,
    };
  }

  /**
   * Which Google lead forms (`asset.id` = webhook `form_id`) feed this Lyra
   * form. The webhook rows teach it: when they match the API rows, only those
   * forms are imported; otherwise forms already linked to another Lyra form are
   * left out; with no evidence at all, every lead of the account is taken.
   */
  private async formFilter(
    form: FormEntity,
    leads: Array<ParsedGoogleAdsLead | null>,
  ): Promise<(lead: ParsedGoogleAdsLead) => boolean> {
    const rows = await this.forms.query<
      Array<{ formId: string; providerFormId: string }>
    >(
      `SELECT "form_id" AS "formId", "attribution"->>'formId' AS "providerFormId"
         FROM "form_submissions"
        WHERE "tenant_id" = $1 AND "workspace_id" = $2 AND "source" = 'google_ads'
          AND "attribution"->>'formId' IS NOT NULL
        GROUP BY 1, 2`,
      [form.tenantId, form.workspaceId],
    );
    const own = new Set<string>();
    const others = new Set<string>();
    for (const row of rows)
      (row.formId === form.id ? own : others).add(row.providerFormId);

    const seen = new Set(
      leads.flatMap((lead) => (lead?.formId ? [lead.formId] : [])),
    );
    const meets = (ids: Set<string>) => [...seen].some((id) => ids.has(id));
    if (meets(own))
      return (lead) => lead.formId !== null && own.has(lead.formId);
    if (meets(others))
      return (lead) => lead.formId === null || !others.has(lead.formId);
    return () => true;
  }

  /** D-L3 layers 1 and 2: same id, or same `gclid` on this form within 30 days. */
  private async findExisting(
    formId: string,
    lead: ParsedGoogleAdsLead,
  ): Promise<{ externalLeadId: string; origin: string | null } | null> {
    const rows = await this.forms.query<
      Array<{ externalLeadId: string; origin: string | null }>
    >(
      `SELECT "external_lead_id" AS "externalLeadId", "payload"->>'origin' AS "origin"
         FROM "form_submissions"
        WHERE "form_id" = $1 AND "source" = 'google_ads'
          AND ("external_lead_id" = $2
               OR ($3::text IS NOT NULL
                   AND "attribution"->>'gclid' = $3
                   AND COALESCE("attribution"->>'isTest', 'false') <> 'true'
                   AND "created_at" BETWEEN $4::timestamptz - make_interval(days => $5)
                                        AND $4::timestamptz + make_interval(days => $5)))
        ORDER BY ("external_lead_id" = $2) DESC
        LIMIT 1`,
      [
        formId,
        lead.leadId,
        lead.gclid,
        lead.submittedAt ?? new Date().toISOString(),
        GCLID_WINDOW_DAYS,
      ],
    );
    return rows[0] ?? null;
  }

  private async patchSettings(
    formId: string,
    patch: Partial<FormGoogleAdsLeads>,
  ) {
    await this.forms.query(
      `UPDATE "forms" SET "google_ads_leads" = "google_ads_leads" || $2::jsonb WHERE "id" = $1`,
      [formId, JSON.stringify(patch)],
    );
  }

  /** Maps a credential/API failure to an HTTP error carrying only its code, and records the code. */
  private async failed(formId: string, error: unknown): Promise<unknown> {
    let mapped: unknown = error;
    if (error instanceof SocialAdCredentialError)
      mapped =
        error.code === 'connection_not_found'
          ? new NotFoundException(error.code)
          : new UnprocessableEntityException(error.code);
    else if (error instanceof GoogleAdsError)
      mapped =
        error.kind === 'auth'
          ? new UnprocessableEntityException(error.code)
          : new ServiceUnavailableException(error.code);

    const code = this.errorCode(mapped);
    this.logger.warn(`Google Ads import of form ${formId} failed (${code}).`);
    try {
      await this.patchSettings(formId, { lastImportError: code });
    } catch {
      // The HTTP answer already carries the code.
    }
    return mapped;
  }

  private errorCode(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      const message =
        typeof response === 'object' && response !== null
          ? (response as { message?: unknown }).message
          : response;
      return typeof message === 'string' ? message : error.name;
    }
    if (error instanceof SocialAdCredentialError) return error.code;
    if (error instanceof GoogleAdsError) return error.code;
    return error instanceof Error ? error.name : 'UnknownError';
  }
}
