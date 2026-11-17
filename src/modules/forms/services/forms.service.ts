import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { In, MoreThanOrEqual, QueryFailedError, Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import {
  AgencySalesPipelineEntity,
  AgencySalesStageEntity,
} from '../../agency/entities/agency-sales.entities';
import { CrmService } from '../../crm/crm.service';
import type {
  CapturePublicFormDto,
  CreateFormDto,
  ListFormSubmissionsQueryDto,
  ListFormsQueryDto,
  PatchFormDto,
  SubmitPublicFormDto,
} from '../dto/forms.dto';
import { FormEntity } from '../entities/form.entity';
import { FormSubmissionEntity } from '../entities/form-submission.entity';
import {
  assertPublishable,
  validateAfterSubmit,
  validateCapture,
  validateDestination,
  validateFieldsConfig,
  validatePresentation,
  validateTracking,
  validateSecurity,
} from '../form-config.validator';
import {
  FormValidationError,
  normalizeSubmission,
  sanitizeAttribution,
} from '../form-submission.normalizer';
import {
  CaptureFormatError,
  isCaptureOriginAllowed,
  normalizeCapture,
  parseCapturePayload,
  summarizeCapturedFields,
} from '../form-capture.mapper';
import type {
  CapturedField,
  FormDestination,
  NormalizedSubmission,
} from '../forms.types';
import {
  FormLeadIngestionService,
  formRequestContext,
} from './form-lead-ingestion.service';
import { FormsAddonService } from './forms-addon.service';

/** Per form + visitor: at most this many submissions in the window (the edge already caps 120 req/min per IP). */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60_000;

export type PublicSubmitMeta = { ip: string | null; userAgent: string | null };
export type PublicCaptureMeta = PublicSubmitMeta & {
  origin: string | null;
  referer: string | null;
};

export function generatePublicKey(): string {
  return `f_${randomBytes(12).toString('hex')}`;
}

export function hashVisitorIp(
  formId: string,
  ip: string | null,
): string | null {
  if (!ip) return null;
  return createHash('sha256').update(`${formId}:${ip}`).digest('hex');
}

function capturedFieldsOf(payload: Record<string, unknown>): CapturedField[] {
  return Array.isArray(payload?.fields)
    ? (payload.fields as CapturedField[])
    : [];
}

function requireScope(ctx: RequestContext) {
  if (!ctx.workspaceId)
    throw new BadRequestException('Workspace context is required.');
  return { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId };
}

@Injectable()
export class FormsService {
  constructor(
    @InjectRepository(FormEntity, 'agency')
    private readonly forms: Repository<FormEntity>,
    @InjectRepository(FormSubmissionEntity, 'agency')
    private readonly submissions: Repository<FormSubmissionEntity>,
    @InjectRepository(AgencySalesPipelineEntity, 'agency')
    private readonly salesPipelines: Repository<AgencySalesPipelineEntity>,
    @InjectRepository(AgencySalesStageEntity, 'agency')
    private readonly salesStages: Repository<AgencySalesStageEntity>,
    private readonly crm: CrmService,
    private readonly addon: FormsAddonService,
    private readonly ingestion: FormLeadIngestionService,
  ) {}

  // ── Admin ────────────────────────────────────────────────────────────────

  async list(ctx: RequestContext, query: ListFormsQueryDto = {}) {
    const scope = requireScope(ctx);
    await this.addon.assertEnabled(scope.tenantId, scope.workspaceId);
    const forms = await this.forms.find({
      where: {
        ...scope,
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.agencyClientId
          ? { agencyClientId: query.agencyClientId }
          : {}),
      },
      order: { updatedAt: 'DESC' },
    });
    const stats = forms.length
      ? await this.submissions
          .createQueryBuilder('s')
          .select('s.form_id', 'formId')
          .addSelect(
            `COUNT(*) FILTER (WHERE s.created_at >= now() - interval '7 days' AND s.status <> 'spam')`,
            'last7d',
          )
          .addSelect(
            `COUNT(*) FILTER (WHERE s.created_at >= now() - interval '30 days' AND s.status <> 'spam')`,
            'last30d',
          )
          .addSelect(
            `MAX(s.created_at) FILTER (WHERE s.status <> 'spam')`,
            'lastAt',
          )
          .where(
            's.tenant_id = :tenantId AND s.workspace_id = :workspaceId',
            scope,
          )
          .andWhere('s.form_id IN (:...ids)', {
            ids: forms.map((form) => form.id),
          })
          .groupBy('s.form_id')
          .getRawMany<{
            formId: string;
            last7d: string;
            last30d: string;
            lastAt: Date | null;
          }>()
      : [];
    const byForm = new Map(stats.map((row) => [row.formId, row]));
    return forms.map((form) => {
      const row = byForm.get(form.id);
      return {
        ...form,
        stats: {
          submissionsLast7d: Number(row?.last7d ?? 0),
          submissionsLast30d: Number(row?.last30d ?? 0),
          lastSubmissionAt: row?.lastAt ?? null,
        },
      };
    });
  }

  async get(ctx: RequestContext, id: string) {
    const scope = requireScope(ctx);
    await this.addon.assertEnabled(scope.tenantId, scope.workspaceId);
    const form = await this.forms.findOne({ where: { ...scope, id } });
    if (!form) throw new NotFoundException('Form not found.');
    // Rows created before F3 have `{}`.
    form.capture = validateCapture(form.capture);
    return form;
  }

  async create(ctx: RequestContext, dto: CreateFormDto) {
    const scope = requireScope(ctx);
    await this.addon.assertEnabled(scope.tenantId, scope.workspaceId);
    // F5 brings the fiscal schema, link and certificate; until then only lead capture exists.
    if (dto.type !== 'lead_capture')
      throw new BadRequestException(
        'Only lead_capture forms are available in this release.',
      );
    const { agencyClientId, companyContextId } = this.validateClientScope(dto);
    const destination = validateDestination(dto.destination);
    this.assertDestinationMatchesScope(destination, agencyClientId);

    const form = this.forms.create({
      ...scope,
      agencyClientId,
      companyContextId,
      type: dto.type,
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      status: 'draft',
      publicKey: generatePublicKey(),
      schemaVersion: 1,
      fields: validateFieldsConfig(dto.fields),
      presentation: validatePresentation(dto.presentation),
      tracking: validateTracking(dto.tracking),
      destination,
      security: validateSecurity(dto.security),
      afterSubmit: validateAfterSubmit(dto.afterSubmit),
      createdByUserId: ctx.userId ?? null,
      publishedAt: null,
      archivedAt: null,
    });
    return this.forms.save(form);
  }

  async patch(ctx: RequestContext, id: string, dto: PatchFormDto) {
    const form = await this.get(ctx, id);
    if (form.status === 'archived')
      throw new ConflictException('Archived forms cannot be edited.');
    if (dto.name !== undefined) form.name = dto.name.trim();
    if (dto.description !== undefined)
      form.description = dto.description?.trim() || null;
    if (dto.fields !== undefined) {
      form.fields = validateFieldsConfig(dto.fields);
      // Submissions keep the version they were answered with.
      if (form.publishedAt) form.schemaVersion += 1;
    }
    if (dto.presentation !== undefined)
      form.presentation = validatePresentation(dto.presentation);
    if (dto.tracking !== undefined)
      form.tracking = validateTracking(dto.tracking);
    if (dto.security !== undefined)
      form.security = validateSecurity(dto.security);
    if (dto.afterSubmit !== undefined)
      form.afterSubmit = validateAfterSubmit(dto.afterSubmit);
    if (dto.capture !== undefined) form.capture = validateCapture(dto.capture);
    if (dto.destination !== undefined) {
      const destination = validateDestination(dto.destination);
      this.assertDestinationMatchesScope(destination, form.agencyClientId);
      form.destination = destination;
    }
    if (form.status === 'active') {
      assertPublishable(form.fields);
      await this.assertDestinationExists(form);
    }
    return this.forms.save(form);
  }

  async publish(ctx: RequestContext, id: string) {
    const form = await this.get(ctx, id);
    if (form.status === 'archived')
      throw new ConflictException('Archived forms cannot be published.');
    assertPublishable(form.fields);
    await this.assertDestinationExists(form);
    form.status = 'active';
    form.publishedAt ??= new Date();
    return this.forms.save(form);
  }

  async deactivate(ctx: RequestContext, id: string) {
    const form = await this.get(ctx, id);
    if (form.status === 'archived')
      throw new ConflictException('Form is archived.');
    form.status = 'inactive';
    return this.forms.save(form);
  }

  async archive(ctx: RequestContext, id: string) {
    const form = await this.get(ctx, id);
    form.status = 'archived';
    form.archivedAt = new Date();
    return this.forms.save(form);
  }

  /** Invalidates every embed/link in use; the old key stops answering at once. */
  async rotateKey(ctx: RequestContext, id: string) {
    const form = await this.get(ctx, id);
    form.publicKey = generatePublicKey();
    return this.forms.save(form);
  }

  async remove(ctx: RequestContext, id: string) {
    const form = await this.get(ctx, id);
    const count = await this.submissions.count({ where: { formId: form.id } });
    if (count > 0)
      throw new ConflictException('Form has submissions; archive it instead.');
    await this.forms.delete({
      id: form.id,
      tenantId: form.tenantId,
      workspaceId: form.workspaceId,
    });
    return { deleted: true };
  }

  async listSubmissions(
    ctx: RequestContext,
    formId: string,
    query: ListFormSubmissionsQueryDto = {},
  ) {
    const form = await this.get(ctx, formId);
    const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(query.offset ?? 0) || 0, 0);
    const [items, total] = await this.submissions.findAndCount({
      where: {
        tenantId: form.tenantId,
        workspaceId: form.workspaceId,
        formId: form.id,
        ...(query.status ? { status: query.status } : {}),
      },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { items, total, limit, offset };
  }

  async getSubmission(ctx: RequestContext, submissionId: string) {
    const scope = requireScope(ctx);
    await this.addon.assertEnabled(scope.tenantId, scope.workspaceId);
    const submission = await this.submissions.findOne({
      where: { ...scope, id: submissionId },
    });
    if (!submission) throw new NotFoundException('Submission not found.');
    return submission;
  }

  async reprocessSubmission(ctx: RequestContext, submissionId: string) {
    const submission = await this.getSubmission(ctx, submissionId);
    if (submission.opportunityId)
      throw new ConflictException('Submission already has an opportunity.');
    const form = await this.get(ctx, submission.formId);
    if (submission.status === 'spam') submission.status = 'received';
    // Captured site forms are re-mapped with the current field mapping (learning mode).
    if (submission.source === 'script')
      submission.normalized = normalizeCapture(
        capturedFieldsOf(submission.payload),
        form.capture.fieldMap,
      );
    return this.ingestion.process(form, submission);
  }

  /** Fields seen in the latest captures and where each one goes (§5.6 learning mode). */
  async listCaptureFields(ctx: RequestContext, formId: string) {
    const form = await this.get(ctx, formId);
    const recent = await this.submissions.find({
      select: { id: true, payload: true },
      where: {
        tenantId: form.tenantId,
        workspaceId: form.workspaceId,
        formId: form.id,
        source: 'script',
      },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return {
      captures: recent.length,
      fields: summarizeCapturedFields(
        recent.map((row) => row.payload),
        form.capture.fieldMap,
      ),
    };
  }

  async markSpam(ctx: RequestContext, submissionId: string) {
    const submission = await this.getSubmission(ctx, submissionId);
    submission.status = 'spam';
    return this.submissions.save(submission);
  }

  // ── Public ───────────────────────────────────────────────────────────────

  /** Active form of an enabled workspace, or 404 (never tells which part failed). */
  private async findPublicForm(publicKey: string): Promise<FormEntity> {
    const form =
      typeof publicKey === 'string' && /^f_[0-9a-f]{24}$/.test(publicKey)
        ? await this.forms.findOne({
            where: { publicKey, status: 'active', type: 'lead_capture' },
          })
        : null;
    if (!form || !(await this.addon.isEnabled(form.tenantId, form.workspaceId)))
      throw new NotFoundException('Form not found.');
    return form;
  }

  async getPublicConfig(publicKey: string) {
    const form = await this.findPublicForm(publicKey);
    return {
      publicKey: form.publicKey,
      name: form.name,
      description: form.description,
      schemaVersion: form.schemaVersion,
      fields: form.fields,
      // Rows saved before F2 typed these get the defaults filled in.
      presentation: validatePresentation(form.presentation),
      tracking: validateTracking(form.tracking),
      afterSubmit: form.afterSubmit,
      consentText: form.security.consentText ?? null,
      // The embedded page refuses to render on hosts outside this list (§5.6).
      allowedOrigins: form.security.allowedOrigins ?? [],
      minFillSeconds: form.security.minFillSeconds ?? 0,
    };
  }

  async submitPublic(
    publicKey: string,
    dto: SubmitPublicFormDto,
    meta: PublicSubmitMeta,
  ) {
    const form = await this.findPublicForm(publicKey);
    const response = { ok: true as const, afterSubmit: form.afterSubmit };

    const ipHash = await this.assertRateLimit(form.id, meta.ip);

    if (dto.nonce) {
      const replay = await this.submissions.findOne({
        where: { formId: form.id, clientNonce: dto.nonce },
      });
      if (replay) return { ...response, submissionId: replay.id };
    }

    const declared = new Set(form.fields.fields.map((field) => field.key));
    const rawValues = Object.fromEntries(
      Object.entries(dto.values ?? {}).filter(([key]) => declared.has(key)),
    );

    // Bots get the same answer as people; the row is kept as spam for review.
    const minFillMs = (form.security.minFillSeconds ?? 0) * 1000;
    const isSpam =
      Boolean(dto.hp && String(dto.hp).trim()) ||
      (minFillMs > 0 &&
        typeof dto.elapsedMs === 'number' &&
        dto.elapsedMs < minFillMs);

    let normalized: NormalizedSubmission | null = null;
    if (!isSpam) {
      try {
        normalized = normalizeSubmission(form.fields.fields, rawValues);
      } catch (error) {
        if (error instanceof FormValidationError)
          throw new UnprocessableEntityException({
            message: 'Invalid fields.',
            fieldErrors: error.fieldErrors,
          });
        throw error;
      }
    }

    let submission: FormSubmissionEntity;
    try {
      submission = await this.submissions.save(
        this.submissions.create({
          tenantId: form.tenantId,
          workspaceId: form.workspaceId,
          agencyClientId: form.agencyClientId,
          companyContextId: form.companyContextId,
          formId: form.id,
          schemaVersion: form.schemaVersion,
          source: dto.source === 'embed' ? 'embed' : 'page',
          payload: rawValues,
          normalized,
          attribution: sanitizeAttribution(dto.attribution),
          clientNonce: dto.nonce ?? null,
          ipHash,
          userAgent: meta.userAgent?.slice(0, 400) ?? null,
          status: isSpam ? 'spam' : 'received',
          error: null,
          contactId: null,
          opportunityId: null,
          outcome: {},
          processedAt: isSpam ? new Date() : null,
        }),
      );
    } catch (error) {
      // Two concurrent retries with the same nonce: the loser returns the winner.
      if (
        dto.nonce &&
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23505'
      ) {
        const winner = await this.submissions.findOne({
          where: { formId: form.id, clientNonce: dto.nonce },
        });
        if (winner) return { ...response, submissionId: winner.id };
      }
      throw error;
    }

    if (!isSpam) await this.ingestion.process(form, submission);
    return { ...response, submissionId: submission.id };
  }

  /**
   * capture.js (F3): a copy of what the site's own form sent. The site keeps
   * its own flow (PHP etc.); this never answers with anything the script uses.
   */
  async capturePublic(
    publicKey: string,
    dto: CapturePublicFormDto,
    meta: PublicCaptureMeta,
  ): Promise<void> {
    const form = await this.findPublicForm(publicKey);
    // Other sites cannot feed leads in through a copied snippet (§5.6).
    if (
      !isCaptureOriginAllowed(
        meta.origin,
        meta.referer,
        form.security.allowedOrigins ?? [],
      )
    )
      throw new ForbiddenException('Origin not allowed for this form.');

    let parsed: ReturnType<typeof parseCapturePayload>;
    try {
      parsed = parseCapturePayload(dto.payload);
    } catch (error) {
      if (error instanceof CaptureFormatError)
        throw new BadRequestException(error.message);
      throw error;
    }
    if (!parsed.fields.length) return;

    const ipHash = await this.assertRateLimit(form.id, meta.ip);
    if (parsed.nonce) {
      const replay = await this.submissions.findOne({
        where: { formId: form.id, clientNonce: parsed.nonce },
      });
      if (replay) return;
    }

    // Time since the page loaded: bots post within milliseconds.
    const minFillMs = (form.security.minFillSeconds ?? 0) * 1000;
    const isSpam =
      minFillMs > 0 &&
      parsed.elapsedMs !== null &&
      parsed.elapsedMs < minFillMs;
    const capture = validateCapture(form.capture);

    let submission: FormSubmissionEntity;
    try {
      submission = await this.submissions.save(
        this.submissions.create({
          tenantId: form.tenantId,
          workspaceId: form.workspaceId,
          agencyClientId: form.agencyClientId,
          companyContextId: form.companyContextId,
          formId: form.id,
          schemaVersion: form.schemaVersion,
          source: 'script',
          payload: { fields: parsed.fields },
          normalized: normalizeCapture(parsed.fields, capture.fieldMap),
          attribution: sanitizeAttribution(parsed.attribution),
          clientNonce: parsed.nonce,
          ipHash,
          userAgent: meta.userAgent?.slice(0, 400) ?? null,
          status: isSpam ? 'spam' : 'received',
          error: null,
          contactId: null,
          opportunityId: null,
          outcome: {},
          processedAt: isSpam ? new Date() : null,
        }),
      );
    } catch (error) {
      // Same nonce raced (submit + click fallback): the first row wins.
      if (
        parsed.nonce &&
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23505'
      )
        return;
      throw error;
    }
    if (!isSpam) await this.ingestion.process(form, submission);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Per form + visitor cap; returns the visitor hash stored on the row. */
  private async assertRateLimit(formId: string, ip: string | null) {
    const ipHash = hashVisitorIp(formId, ip);
    if (!ipHash) return null;
    const recent = await this.submissions.count({
      where: {
        formId,
        ipHash,
        createdAt: MoreThanOrEqual(new Date(Date.now() - RATE_LIMIT_WINDOW_MS)),
      },
    });
    if (recent >= RATE_LIMIT_MAX)
      throw new HttpException(
        'Too many submissions. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    return ipHash;
  }

  private validateClientScope(
    dto: Pick<CreateFormDto, 'agencyClientId' | 'companyContextId'>,
  ) {
    const agencyClientId = dto.agencyClientId ?? null;
    const companyContextId = dto.companyContextId ?? null;
    if (Boolean(agencyClientId) !== Boolean(companyContextId))
      throw new BadRequestException(
        'agencyClientId and companyContextId go together.',
      );
    return { agencyClientId, companyContextId };
  }

  /** The Agency CRM has no client scope; a client's leads always go to its LeadFlow CRM. */
  private assertDestinationMatchesScope(
    destination: FormDestination,
    agencyClientId: string | null,
  ) {
    if (agencyClientId && destination.target !== 'leadflow_crm')
      throw new BadRequestException(
        "A client's form must send leads to the LeadFlow CRM.",
      );
  }

  /**
   * Pipeline/stage must exist in the destination CRM and scope. The LeadFlow
   * lookup runs under the form's own context, so a pipeline of another company
   * is simply not found.
   */
  private async assertDestinationExists(form: FormEntity) {
    const { target, pipelineId, stageId } = form.destination;
    if (stageId && !pipelineId)
      throw new BadRequestException(
        'Choose the pipeline of the selected stage.',
      );
    if (target === 'leadflow_crm') {
      const ctx = formRequestContext(form);
      if (pipelineId) await this.crm.getPipeline(ctx, pipelineId);
      if (stageId) {
        const stage = await this.crm.getStage(ctx, stageId);
        if (stage.pipelineId !== pipelineId)
          throw new BadRequestException(
            'Stage does not belong to the pipeline.',
          );
      }
      return;
    }
    const scope = { tenantId: form.tenantId, workspaceId: form.workspaceId };
    if (pipelineId) {
      const pipeline = await this.salesPipelines.findOne({
        where: { ...scope, id: pipelineId },
      });
      if (!pipeline) throw new BadRequestException('Sales pipeline not found.');
    } else {
      const any = await this.salesPipelines.count({
        where: { ...scope, status: In(['active']) },
      });
      if (!any)
        throw new BadRequestException(
          'The Agency CRM has no active pipeline yet.',
        );
    }
    if (stageId) {
      const stage = await this.salesStages.findOne({
        where: { ...scope, id: stageId, pipelineId: pipelineId! },
      });
      if (!stage)
        throw new BadRequestException('Sales stage not found in the pipeline.');
    }
  }
}
