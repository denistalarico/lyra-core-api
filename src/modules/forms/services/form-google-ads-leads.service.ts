import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { UpdateFormGoogleAdsLeadsDto } from '../dto/forms.dto';
import { FormEntity } from '../entities/form.entity';
import { FormSubmissionEntity } from '../entities/form-submission.entity';
import {
  GoogleAdsLeadFormatError,
  type ParsedGoogleAdsLead,
  googleAdsExternalLeadId,
  googleAdsLeadAttribution,
  normalizeGoogleAdsLead,
  parseGoogleAdsLead,
} from '../google-ads-lead.normalizer';
import {
  DEFAULT_FORM_GOOGLE_ADS_LEADS,
  DEFAULT_FORM_META_LEADS,
  type FormGoogleAdsLeads,
  type FormGoogleAdsLeadsView,
} from '../forms.types';
import { FormLeadIngestionService } from './form-lead-ingestion.service';
import { FormsAddonService } from './forms-addon.service';

/** Public host of the API behind nginx (`/api/public/*`); only the form key changes. */
const WEBHOOK_BASE_URL = 'https://api.lyrasuite.com/api/public/forms';
const MAX_BODY_BYTES = 64 * 1024;
const FAILED_MESSAGE =
  'Não foi possível enviar o lead ao CRM. Reprocesse a submissão na lista.';

export function hashGoogleAdsLeadsKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Read DTO of §5.4: stored settings over the defaults, plus the URL to paste in Google Ads. */
export function googleAdsLeadsView(
  form: Pick<FormEntity, 'publicKey' | 'googleAdsLeads'>,
): FormGoogleAdsLeadsView {
  return {
    ...DEFAULT_FORM_GOOGLE_ADS_LEADS,
    ...(form.googleAdsLeads ?? {}),
    webhookUrl: `${WEBHOOK_BASE_URL}/${form.publicKey}/google-ads-leads`,
  };
}

/** Every form response carries both ad-lead channels with their defaults (GL1, ML1). */
export function withGoogleAdsLeadsView<
  T extends Pick<FormEntity, 'publicKey' | 'googleAdsLeads' | 'metaLeads'>,
>(form: T) {
  return {
    ...form,
    googleAdsLeads: googleAdsLeadsView(form),
    metaLeads: { ...DEFAULT_FORM_META_LEADS, ...(form.metaLeads ?? {}) },
  };
}

/**
 * GL1 (D-L1..D-L5): the Google Ads lead-form webhook. The lead enters as a
 * `form_submissions` row (source `google_ads`) and goes to the CRM through the
 * same ingestion as every other source.
 *
 * PII (name, e-mail, phone) never reaches a log line, an exception message or
 * `last_error`: only ids and error class names are written.
 */
@Injectable()
export class FormGoogleAdsLeadsService {
  private readonly logger = new Logger(FormGoogleAdsLeadsService.name);

  constructor(
    @InjectRepository(FormEntity, 'agency')
    private readonly forms: Repository<FormEntity>,
    @InjectRepository(FormSubmissionEntity, 'agency')
    private readonly submissions: Repository<FormSubmissionEntity>,
    private readonly addon: FormsAddonService,
    private readonly ingestion: FormLeadIngestionService,
  ) {}

  // ── Admin ────────────────────────────────────────────────────────────────

  /**
   * The key leaves the server exactly once, here; only its sha256 is kept.
   * 24 random bytes = 48 hex chars (192 bits): the Google Ads webhook "Key"
   * field accepts at most 50 characters.
   */
  async generateKey(form: FormEntity) {
    const key = randomBytes(24).toString('hex');
    const keyHint = key.slice(-4);
    await this.forms.query(
      `UPDATE "forms"
          SET "google_ads_key_hash" = $2,
              "google_ads_leads" = "google_ads_leads" || jsonb_build_object(
                'keyHint', $3::text, 'keyCreatedAt', $4::text, 'enabled', true)
        WHERE "id" = $1`,
      [form.id, hashGoogleAdsLeadsKey(key), keyHint, new Date().toISOString()],
    );
    return { key, keyHint };
  }

  async updateSettings(form: FormEntity, dto: UpdateFormGoogleAdsLeadsDto) {
    const patch: Partial<FormGoogleAdsLeads> = {};
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (dto.sendTestLeadsToCrm !== undefined)
      patch.sendTestLeadsToCrm = dto.sendTestLeadsToCrm;
    if (Object.keys(patch).length)
      await this.forms.query(
        `UPDATE "forms" SET "google_ads_leads" = "google_ads_leads" || $2::jsonb WHERE "id" = $1`,
        [form.id, JSON.stringify(patch)],
      );
    const fresh = await this.forms.findOneByOrFail({ id: form.id });
    return googleAdsLeadsView(fresh);
  }

  // ── Public webhook ───────────────────────────────────────────────────────

  /**
   * D-L5: wrong key → 403; a form that cannot take leads → 404; anything that
   * fails before the row is stored → 503 (Google retries); anything after → 200
   * (the submission is `failed` and the panel reprocesses it).
   */
  async receive(
    publicKey: string,
    body: unknown,
  ): Promise<Record<string, never>> {
    if (process.env.FORMS_GOOGLE_ADS_LEADS_ENABLED === 'false')
      throw new ServiceUnavailableException('Google Ads leads are disabled.');
    if (typeof body !== 'object' || body === null || Array.isArray(body))
      throw new BadRequestException('Body must be a JSON object.');
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES)
      throw new PayloadTooLargeException('Body too large.');

    let form: FormEntity;
    try {
      form = await this.findForm(publicKey);
    } catch (error) {
      throw this.beforeStored('lookup', error);
    }
    this.assertKey(form, (body as Record<string, unknown>).google_key);

    let lead: ParsedGoogleAdsLead;
    try {
      lead = parseGoogleAdsLead(body);
    } catch (error) {
      if (error instanceof GoogleAdsLeadFormatError)
        throw new BadRequestException(error.message);
      throw error;
    }

    let submission: FormSubmissionEntity | null;
    try {
      submission = await this.store(form, lead);
    } catch (error) {
      throw this.beforeStored('store', error, form.id);
    }
    // D-L3: the same lead delivered twice (Google is not exactly-once) → one row.
    if (!submission) return {};

    const settings = {
      ...DEFAULT_FORM_GOOGLE_ADS_LEADS,
      ...form.googleAdsLeads,
    };
    let lastError: string | null = null;
    try {
      if (lead.isTest && !settings.sendTestLeadsToCrm) {
        submission.status = 'needs_review';
        submission.error =
          'Lead de teste: não foi enviado ao CRM (configuração do formulário). Reprocesse para enviar.';
        submission.processedAt = new Date();
        await this.submissions.save(submission);
      } else {
        const processed = await this.ingestion.process(form, submission);
        if (processed.status === 'failed') lastError = FAILED_MESSAGE;
      }
    } catch (error) {
      lastError = FAILED_MESSAGE;
      this.logger.warn(
        `Google Ads lead for form ${form.id} stored as ${submission.id} but not processed (${this.errorName(error)}).`,
      );
    }
    await this.touch(form.id, lead.isTest, lastError);
    return {};
  }

  /** Active form of an enabled workspace with the channel on, or 404 (never says which part failed). */
  private async findForm(publicKey: string): Promise<FormEntity> {
    const form =
      typeof publicKey === 'string' && /^f_[0-9a-f]{24}$/.test(publicKey)
        ? await this.forms
            .createQueryBuilder('f')
            .addSelect('f.googleAdsKeyHash')
            .where('f.publicKey = :publicKey', { publicKey })
            .andWhere("f.status = 'active' AND f.type = 'lead_capture'")
            .getOne()
        : null;
    if (
      !form ||
      form.googleAdsLeads?.enabled !== true ||
      !(await this.addon.isEnabled(form.tenantId, form.workspaceId))
    )
      throw new NotFoundException('Form not found.');
    return form;
  }

  private assertKey(form: FormEntity, provided: unknown) {
    const stored = form.googleAdsKeyHash
      ? Buffer.from(form.googleAdsKeyHash, 'hex')
      : null;
    const candidate = createHash('sha256')
      .update(typeof provided === 'string' ? provided : '')
      .digest();
    if (
      !stored ||
      stored.length !== candidate.length ||
      !timingSafeEqual(stored, candidate)
    )
      throw new ForbiddenException('Invalid key.');
  }

  /**
   * Inserts the submission; `null` when the lead was already stored (the winner
   * of the race keeps it). GL2 imports call it with `origin: 'api'`, which is
   * kept in the payload so the import can tell its rows from the webhook's.
   */
  async store(
    form: FormEntity,
    lead: ParsedGoogleAdsLead,
    origin: 'webhook' | 'api' = 'webhook',
  ): Promise<FormSubmissionEntity | null> {
    const externalLeadId = googleAdsExternalLeadId(lead);
    const result = await this.submissions
      .createQueryBuilder()
      .insert()
      .values({
        tenantId: form.tenantId,
        workspaceId: form.workspaceId,
        agencyClientId: form.agencyClientId,
        companyContextId: form.companyContextId,
        formId: form.id,
        schemaVersion: form.schemaVersion,
        source: 'google_ads',
        externalLeadId,
        // The parsed lead (known fields only): `google_key` and unknown fields are not kept.
        payload: {
          ...lead,
          ...(origin === 'api' ? { origin } : {}),
        } as QueryDeepPartialEntity<FormSubmissionEntity>['payload'],
        normalized: normalizeGoogleAdsLead(lead),
        attribution: googleAdsLeadAttribution(lead),
        status: 'received',
        outcome: {},
      })
      .orIgnore()
      .returning('id')
      .execute();
    const id = (result.raw as Array<{ id: string }>)[0]?.id;
    return id ? await this.submissions.findOneByOrFail({ id }) : null;
  }

  /** Atomic counters: a single UPDATE with jsonb_set, never read-modify-write. */
  private async touch(
    formId: string,
    isTest: boolean,
    lastError: string | null,
  ) {
    const now = new Date().toISOString();
    try {
      if (isTest)
        await this.forms.query(
          `UPDATE "forms"
              SET "google_ads_leads" = jsonb_set("google_ads_leads", '{lastTestAt}', to_jsonb($2::text), true)
            WHERE "id" = $1`,
          [formId, now],
        );
      else
        await this.forms.query(
          `UPDATE "forms"
              SET "google_ads_leads" = jsonb_set(
                    jsonb_set(
                      jsonb_set("google_ads_leads", '{lastReceivedAt}', to_jsonb($2::text), true),
                      '{receivedCount}',
                      to_jsonb(COALESCE(("google_ads_leads"->>'receivedCount')::int, 0) + 1),
                      true),
                    '{lastError}', COALESCE(to_jsonb($3::text), 'null'::jsonb), true)
            WHERE "id" = $1`,
          [formId, now, lastError],
        );
    } catch (error) {
      this.logger.warn(
        `Google Ads counters of form ${formId} not updated (${this.errorName(error)}).`,
      );
    }
  }

  private beforeStored(step: string, error: unknown, formId?: string) {
    if (error instanceof HttpException) return error;
    this.logger.warn(
      `Google Ads lead ${step} failed${formId ? ` for form ${formId}` : ''} (${this.errorName(error)}).`,
    );
    return new ServiceUnavailableException('Try again later.');
  }

  private errorName(error: unknown): string {
    return error instanceof Error ? error.name : 'UnknownError';
  }
}
