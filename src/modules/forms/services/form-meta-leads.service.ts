import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
  type OrganicLeadAdsPage,
  type OrganicLeadAdsScope,
  OrganicLeadAdsError,
  SocialOrganicLeadAdsService,
} from '../../social-organic/lead-ads/social-organic-lead-ads.service';
import {
  type MetaLeadgenOutcome,
  type MetaLeadgenSink,
  SocialOrganicLeadgenRelay,
} from '../../social-organic/webhooks/social-organic-leadgen.relay';
import type { UpdateFormMetaLeadsDto } from '../dto/forms.dto';
import { FormEntity } from '../entities/form.entity';
import { FormSubmissionEntity } from '../entities/form-submission.entity';
import {
  DEFAULT_FORM_META_LEADS,
  type FormMetaLeads,
  type FormMetaLeadsImportResult,
} from '../forms.types';
import {
  type ParsedMetaLead,
  metaExternalLeadId,
  metaLeadAttribution,
  normalizeMetaLead,
  parseMetaLead,
} from '../meta-lead.normalizer';
import { FormLeadIngestionService } from './form-lead-ingestion.service';
import { FormsAddonService } from './forms-addon.service';

const FAILED_MESSAGE =
  'Não foi possível enviar o lead ao CRM. Reprocesse a submissão na lista.';
const TEST_HELD_MESSAGE =
  'Lead de teste: não foi enviado ao CRM (configuração do formulário). Reprocesse para enviar.';
/** 10 pages × 100 leads per Meta form and import. */
const IMPORT_MAX_PAGES = 10;
const MAX_LINKED_PAGES = 20;

export function metaLeadsView(
  form: Pick<FormEntity, 'metaLeads'>,
): FormMetaLeads {
  return { ...DEFAULT_FORM_META_LEADS, ...(form.metaLeads ?? {}) };
}

/** Page picker row (§5.4 `GET forms/meta-leads/pages`). */
export type FormMetaLeadsPageView = Pick<
  OrganicLeadAdsPage,
  'pageId' | 'name' | 'permission' | 'agencyClientId' | 'companyContextId'
>;

/**
 * ML1 (D-L1, D-L3, D-L4, D-L7): Meta Lead Ads → Forms → CRM.
 *
 * The organic webhook relays `page:leadgen` here (the sink is registered on
 * init). The lead is read with the Page token, stored as a `form_submissions`
 * row (source `meta_lead_ads`, one per `leadgen_id`) and routed by the form's
 * destination, exactly like every other source.
 *
 * PII (name, e-mail, phone) never reaches a log line, an exception message,
 * `lastError` or a webhook receipt: only ids and safe codes are written.
 */
@Injectable()
export class FormMetaLeadsService implements OnModuleInit {
  private readonly logger = new Logger(FormMetaLeadsService.name);

  constructor(
    @InjectRepository(FormEntity, 'agency')
    private readonly forms: Repository<FormEntity>,
    @InjectRepository(FormSubmissionEntity, 'agency')
    private readonly submissions: Repository<FormSubmissionEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly addon: FormsAddonService,
    private readonly ingestion: FormLeadIngestionService,
    private readonly leadAds: SocialOrganicLeadAdsService,
    private readonly relay: SocialOrganicLeadgenRelay,
  ) {}

  onModuleInit(): void {
    const sink: MetaLeadgenSink = (input) =>
      this.receive(input.scope, input.notification);
    this.relay.register(sink);
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  /** Connected Pages; with a form, only those in exactly its scope. */
  async listPages(
    tenantId: string,
    workspaceId: string,
    form: FormEntity | null,
  ): Promise<FormMetaLeadsPageView[]> {
    const pages = await this.leadAds.listPages({
      tenantId,
      workspaceId,
      ...(form ? { exact: formScope(form) } : {}),
    });
    return pages.map(
      ({ pageId, name, permission, agencyClientId, companyContextId }) => ({
        pageId,
        name,
        permission,
        agencyClientId,
        companyContextId,
      }),
    );
  }

  async listPageForms(
    tenantId: string,
    workspaceId: string,
    pageId: string,
    form: FormEntity | null,
  ) {
    const pages = await this.leadAds.listPages({
      tenantId,
      workspaceId,
      ...(form ? { exact: formScope(form) } : {}),
    });
    const page = pages.find((candidate) => candidate.pageId === pageId);
    if (!page) throw new NotFoundException('page_not_found');
    try {
      return await this.leadAds.listForms(page);
    } catch (error) {
      throw this.httpError(error);
    }
  }

  /**
   * Saves the links and, when the channel is on, installs the app on every
   * linked Page for `leadgen` (the Page "selection" of §5.5). Saving the same
   * Pages again retries the subscription, which is how a Page reconnected with
   * the new scopes leaves `missing_permission`.
   */
  async updateSettings(form: FormEntity, dto: UpdateFormMetaLeadsDto) {
    const patch: Partial<FormMetaLeads> = {};
    let pages: OrganicLeadAdsPage[] | null = null;
    if (dto.pageIds !== undefined) {
      const wanted = [...new Set(dto.pageIds)];
      if (wanted.length > MAX_LINKED_PAGES)
        throw new UnprocessableEntityException('too_many_pages');
      const available = await this.leadAds.listPages({
        tenantId: form.tenantId,
        workspaceId: form.workspaceId,
        exact: formScope(form),
      });
      pages = wanted.map((pageId) => {
        const page = available.find((candidate) => candidate.pageId === pageId);
        if (!page) throw new UnprocessableEntityException('page_not_in_scope');
        return page;
      });
      patch.pageIds = wanted;
    }
    if (dto.formIds !== undefined)
      patch.formIds = dto.formIds === null ? null : [...new Set(dto.formIds)];
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (dto.sendTestLeadsToCrm !== undefined)
      patch.sendTestLeadsToCrm = dto.sendTestLeadsToCrm;

    const next = { ...metaLeadsView(form), ...patch };
    if (next.enabled && next.pageIds.length) {
      pages ??= await this.pagesOf(form, next.pageIds);
      const subscription: FormMetaLeads['subscription'] = {};
      for (const page of pages)
        subscription[page.pageId] = await this.leadAds.subscribe(page);
      patch.subscription = subscription;
    }

    if (Object.keys(patch).length)
      await this.forms.query(
        `UPDATE "forms" SET "meta_leads" = "meta_leads" || $2::jsonb WHERE "id" = $1`,
        [form.id, JSON.stringify(patch)],
      );
    const fresh = await this.forms.findOneByOrFail({ id: form.id });
    return metaLeadsView(fresh);
  }

  /** Earlier leads through `GET /{form-id}/leads` (Meta keeps them for a limited time). */
  async importLeads(form: FormEntity): Promise<FormMetaLeadsImportResult> {
    const settings = metaLeadsView(form);
    if (
      !settings.enabled ||
      form.status !== 'active' ||
      form.type !== 'lead_capture'
    )
      throw new UnprocessableEntityException('meta_leads_disabled');
    if (!settings.pageIds.length)
      throw new UnprocessableEntityException('meta_leads_no_pages');

    // One import per form at a time (webhook races are D-L3's ON CONFLICT).
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    const lockKey = `forms_meta_leads_import:${form.id}`;
    try {
      const [{ locked }] = (await runner.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [lockKey],
      )) as Array<{ locked: boolean }>;
      if (!locked) throw new ConflictException('import_in_progress');
      try {
        return await this.runImport(form, settings);
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

  private async runImport(
    form: FormEntity,
    settings: FormMetaLeads,
  ): Promise<FormMetaLeadsImportResult> {
    const result: FormMetaLeadsImportResult = {
      read: 0,
      created: 0,
      duplicates: 0,
      skipped: 0,
      failed: 0,
      truncated: false,
      oldestSubmittedAt: null,
    };
    try {
      for (const page of await this.pagesOf(form, settings.pageIds)) {
        const metaFormIds =
          settings.formIds ??
          (await this.leadAds.listForms(page)).map((metaForm) => metaForm.id);
        for (const metaFormId of metaFormIds) {
          const { leads, truncated } = await this.leadAds.listFormLeads(
            page,
            metaFormId,
            IMPORT_MAX_PAGES,
          );
          result.truncated ||= truncated;
          for (const raw of leads) {
            const lead = parseMetaLead(raw, page.pageId);
            if (!lead) {
              result.skipped += 1;
              continue;
            }
            result.read += 1;
            lead.formId ??= metaFormId;
            if (
              lead.submittedAt &&
              (!result.oldestSubmittedAt ||
                lead.submittedAt < result.oldestSubmittedAt)
            )
              result.oldestSubmittedAt = lead.submittedAt;
            const submission = await this.store(form, lead, 'api');
            if (!submission) {
              result.duplicates += 1;
              continue;
            }
            result.created += 1;
            if (await this.deliver(form, settings, submission, lead))
              result.failed += 1;
          }
        }
      }
    } catch (error) {
      const code =
        error instanceof OrganicLeadAdsError
          ? error.code
          : 'meta_leads_import_failed';
      await this.patchQuietly(form.id, { lastImportError: code });
      if (!(error instanceof OrganicLeadAdsError))
        this.logger.warn(
          `Meta leads import of form ${form.id} failed (${errorName(error)}).`,
        );
      throw this.httpError(error);
    }
    await this.patchQuietly(form.id, {
      lastImport: { ...result, at: new Date().toISOString() },
      lastImportError: null,
    });
    this.logger.log(
      `Meta leads import (form ${form.id}): read=${result.read} created=${result.created} duplicates=${result.duplicates} skipped=${result.skipped} failed=${result.failed} truncated=${result.truncated}`,
    );
    return result;
  }

  // ── Webhook (relayed by the organic worker) ──────────────────────────────

  /**
   * One `leadgen` notification. Retryable outcomes are only the transient ones
   * (Graph unavailable, store failed); the CRM step never makes the receipt
   * fail, because the submission is already stored and the panel reprocesses.
   */
  async receive(
    scope: OrganicLeadAdsScope & { assetId: string },
    notification: Parameters<MetaLeadgenSink>[0]['notification'],
  ): Promise<MetaLeadgenOutcome> {
    if (process.env.FORMS_META_LEADS_ENABLED === 'false')
      return { kind: 'unhandled', safeErrorCode: 'meta_leads_disabled' };

    const linked = await this.forms
      .createQueryBuilder('f')
      .where('f.tenantId = :tenantId AND f.workspaceId = :workspaceId', scope)
      .andWhere(
        'f.agency_client_id IS NOT DISTINCT FROM CAST(:agencyClientId AS uuid)',
        { agencyClientId: scope.agencyClientId },
      )
      .andWhere(
        'f.company_context_id IS NOT DISTINCT FROM CAST(:companyContextId AS uuid)',
        { companyContextId: scope.companyContextId },
      )
      .andWhere("f.status = 'active' AND f.type = 'lead_capture'")
      .andWhere("f.meta_leads ->> 'enabled' = 'true'")
      .andWhere(
        "(f.meta_leads -> 'pageIds') @> jsonb_build_array(CAST(:pageId AS text))",
        { pageId: notification.pageId },
      )
      .orderBy('f.createdAt', 'ASC')
      .getMany();

    const form = routeLead(linked, notification.formId);
    if (!form) {
      // D-L7: never a "default" CRM. A linked Page whose form is filtered out
      // counts on the forms that saw it; a Page no form links stays in the receipt.
      if (linked.length) await this.bumpUnrouted(linked.map((f) => f.id));
      return { kind: 'unhandled', safeErrorCode: 'lead_unrouted' };
    }
    if (!(await this.addon.isEnabled(form.tenantId, form.workspaceId)))
      return { kind: 'unhandled', safeErrorCode: 'forms_addon_disabled' };

    let raw: Record<string, unknown>;
    try {
      raw = await this.leadAds.readLead(scope, notification.leadgenId);
    } catch (error) {
      if (error instanceof OrganicLeadAdsError && error.kind === 'transient')
        return { kind: 'failed', safeErrorCode: 'lead_read_failed' };
      const code =
        error instanceof OrganicLeadAdsError ? error.code : 'lead_read_failed';
      await this.patchQuietly(form.id, { lastError: code });
      return {
        kind: 'unhandled',
        safeErrorCode:
          error instanceof OrganicLeadAdsError && error.kind === 'permission'
            ? 'lead_read_denied'
            : 'lead_read_rejected',
      };
    }

    const lead = parseMetaLead(raw, notification.pageId);
    if (!lead) return { kind: 'unhandled', safeErrorCode: 'malformed_payload' };
    lead.formId ??= notification.formId;
    lead.adId ??= notification.adId;

    let submission: FormSubmissionEntity | null;
    try {
      submission = await this.store(form, lead, 'webhook');
    } catch (error) {
      this.logger.warn(
        `Meta lead for form ${form.id} not stored (${errorName(error)}).`,
      );
      return { kind: 'failed', safeErrorCode: 'lead_store_failed' };
    }
    // D-L3: the same `leadgen_id` again (Meta retries, or the import got it first).
    if (!submission) return { kind: 'processed' };

    const failed = await this.deliver(
      form,
      metaLeadsView(form),
      submission,
      lead,
    );
    await this.touch(form.id, lead.isTest, failed ? FAILED_MESSAGE : null);
    return { kind: 'processed' };
  }

  /** Inserts the submission; `null` when this lead was already stored. */
  private async store(
    form: FormEntity,
    lead: ParsedMetaLead,
    origin: 'webhook' | 'api',
  ): Promise<FormSubmissionEntity | null> {
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
        source: 'meta_lead_ads',
        externalLeadId: metaExternalLeadId(lead),
        payload: {
          ...lead,
          origin,
        } as QueryDeepPartialEntity<FormSubmissionEntity>['payload'],
        normalized: normalizeMetaLead(lead),
        attribution: metaLeadAttribution(lead),
        status: 'received',
        outcome: {},
      })
      .orIgnore()
      .returning('id')
      .execute();
    const id = (result.raw as Array<{ id: string }>)[0]?.id;
    return id ? await this.submissions.findOneByOrFail({ id }) : null;
  }

  /** D-L4 + CRM. `true` when the CRM step failed (the submission stays to reprocess). */
  private async deliver(
    form: FormEntity,
    settings: FormMetaLeads,
    submission: FormSubmissionEntity,
    lead: ParsedMetaLead,
  ): Promise<boolean> {
    try {
      if (lead.isTest && !settings.sendTestLeadsToCrm) {
        submission.status = 'needs_review';
        submission.error = TEST_HELD_MESSAGE;
        submission.processedAt = new Date();
        await this.submissions.save(submission);
        return false;
      }
      const processed = await this.ingestion.process(form, submission);
      return processed.status === 'failed';
    } catch (error) {
      this.logger.warn(
        `Meta lead for form ${form.id} stored as ${submission.id} but not processed (${errorName(error)}).`,
      );
      return true;
    }
  }

  private async pagesOf(
    form: FormEntity,
    pageIds: string[],
  ): Promise<OrganicLeadAdsPage[]> {
    const available = await this.leadAds.listPages({
      tenantId: form.tenantId,
      workspaceId: form.workspaceId,
      exact: formScope(form),
    });
    return available.filter((page) => pageIds.includes(page.pageId));
  }

  /** Atomic counters: a single UPDATE with jsonb_set, never read-modify-write. */
  private async touch(
    formId: string,
    isTest: boolean,
    lastError: string | null,
  ) {
    const now = new Date().toISOString();
    try {
      await this.forms.query(
        `UPDATE "forms"
            SET "meta_leads" = jsonb_set(
                  jsonb_set(
                    jsonb_set("meta_leads", $4::text[], to_jsonb($2::text), true),
                    '{receivedCount}',
                    to_jsonb(COALESCE(("meta_leads"->>'receivedCount')::int, 0) + 1),
                    true),
                  '{lastError}', COALESCE(to_jsonb($3::text), 'null'::jsonb), true)
          WHERE "id" = $1`,
        [formId, now, lastError, [isTest ? 'lastTestAt' : 'lastReceivedAt']],
      );
    } catch (error) {
      this.logger.warn(
        `Meta lead counters of form ${formId} not updated (${errorName(error)}).`,
      );
    }
  }

  private async bumpUnrouted(formIds: string[]) {
    try {
      await this.forms.query(
        `UPDATE "forms"
            SET "meta_leads" = jsonb_set("meta_leads", '{unroutedCount}',
                  to_jsonb(COALESCE(("meta_leads"->>'unroutedCount')::int, 0) + 1), true)
          WHERE "id" = ANY($1::uuid[])`,
        [formIds],
      );
    } catch (error) {
      this.logger.warn(
        `Meta lead unrouted counter not updated (${errorName(error)}).`,
      );
    }
  }

  private async patchQuietly(formId: string, patch: Partial<FormMetaLeads>) {
    try {
      await this.forms.query(
        `UPDATE "forms" SET "meta_leads" = "meta_leads" || $2::jsonb WHERE "id" = $1`,
        [formId, JSON.stringify(patch)],
      );
    } catch (error) {
      this.logger.warn(
        `Meta leads state of form ${formId} not updated (${errorName(error)}).`,
      );
    }
  }

  private httpError(error: unknown) {
    if (!(error instanceof OrganicLeadAdsError))
      return new ServiceUnavailableException('meta_leads_unavailable');
    return error.kind === 'transient'
      ? new ServiceUnavailableException(error.code)
      : new UnprocessableEntityException(error.code);
  }
}

function formScope(form: FormEntity): OrganicLeadAdsScope {
  return {
    tenantId: form.tenantId,
    workspaceId: form.workspaceId,
    agencyClientId: form.agencyClientId,
    companyContextId: form.companyContextId,
  };
}

/**
 * The form that takes a lead of this Meta form: one that names it in
 * `formIds` first, else one that takes every form of the Page (`formIds`
 * null). Oldest form wins a tie, so the choice is stable.
 */
export function routeLead(
  linked: FormEntity[],
  metaFormId: string | null,
): FormEntity | null {
  const formIdsOf = (form: FormEntity) => metaLeadsView(form).formIds;
  return (
    linked.find(
      (form) =>
        metaFormId !== null && (formIdsOf(form) ?? []).includes(metaFormId),
    ) ??
    linked.find((form) => formIdsOf(form) === null) ??
    null
  );
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
