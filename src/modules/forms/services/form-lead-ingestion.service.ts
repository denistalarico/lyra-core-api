import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { AgencySalesService } from '../../agency/agency-sales.service';
import { AgencySalesOpportunityEntity } from '../../agency/entities/agency-sales.entities';
import { CrmService } from '../../crm/crm.service';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { CrmOpportunityCommandService } from '../../crm/services/crm-opportunity-command.service';
import { FormEntity } from '../entities/form.entity';
import { FormSubmissionEntity } from '../entities/form-submission.entity';
import type {
  FormSubmissionOutcome,
  NormalizedSubmission,
} from '../forms.types';
import {
  FormLeadContactResolver,
  type FormContactScope,
} from './form-lead-contact.resolver';

const SOURCE_LABEL: Record<FormSubmissionEntity['source'], string> = {
  page: 'página pública',
  embed: 'formulário incorporado',
  script: 'captura de formulário do site',
  email: 'e-mail',
};

/** The context a public request lacks: tenant/workspace and scope come from the form, never from the payload. */
export function formRequestContext(form: FormEntity): RequestContext {
  const client = Boolean(form.agencyClientId && form.companyContextId);
  return {
    tenantId: form.tenantId,
    workspaceId: form.workspaceId,
    ...(form.destination.target === 'leadflow_crm'
      ? {
          managedContext: {
            productKey: 'leadflow' as const,
            operatingMode: client ? ('client' as const) : ('agency' as const),
            clientId: client ? form.agencyClientId : null,
            companyContextId: client ? form.companyContextId : null,
            managedTenantId: null,
          },
        }
      : {}),
  };
}

export function buildOpportunityDescription(
  form: FormEntity,
  submission: Pick<FormSubmissionEntity, 'source' | 'attribution'>,
  normalized: NormalizedSubmission,
): string {
  const attribution = Object.entries(submission.attribution ?? {})
    .filter(
      ([key]) =>
        key.startsWith('utm_') || key === 'pageUrl' || key === 'referrer',
    )
    .map(([key, value]) => `${key}: ${value}`);
  return [
    `Lead recebido pelo formulário "${form.name}" (${SOURCE_LABEL[submission.source]}).`,
    normalized.opportunity.notes,
    normalized.summaryLines.length ? '' : null,
    ...normalized.summaryLines,
    attribution.length ? '' : null,
    ...attribution,
  ]
    .filter((line): line is string => line !== null && line !== undefined)
    .join('\n')
    .slice(0, 10_000);
}

/**
 * Turns a stored submission into contact + opportunity (§5.1). Idempotent per
 * submission: once `opportunityId` is set nothing is created again, and the
 * LeadFlow CRM also dedups on the idempotency key.
 */
@Injectable()
export class FormLeadIngestionService {
  private readonly logger = new Logger(FormLeadIngestionService.name);

  constructor(
    @InjectRepository(FormSubmissionEntity, 'agency')
    private readonly submissions: Repository<FormSubmissionEntity>,
    @InjectRepository(CrmOpportunityEntity, 'agency')
    private readonly crmOpportunities: Repository<CrmOpportunityEntity>,
    @InjectRepository(AgencySalesOpportunityEntity, 'agency')
    private readonly salesOpportunities: Repository<AgencySalesOpportunityEntity>,
    private readonly contacts: FormLeadContactResolver,
    private readonly crm: CrmService,
    private readonly crmCommands: CrmOpportunityCommandService,
    private readonly sales: AgencySalesService,
  ) {}

  async process(
    form: FormEntity,
    submission: FormSubmissionEntity,
  ): Promise<FormSubmissionEntity> {
    if (submission.opportunityId || submission.status === 'spam')
      return submission;
    const normalized = submission.normalized;
    if (!normalized)
      return this.finish(
        submission,
        'needs_review',
        'Submission has no normalized data.',
      );

    try {
      const outcome: FormSubmissionOutcome = {
        opportunityTarget: form.destination.target,
      };
      const scope: FormContactScope = {
        tenantId: form.tenantId,
        workspaceId: form.workspaceId,
        agencyClientId: form.agencyClientId,
        companyContextId: form.companyContextId,
      };

      let contactId = submission.contactId;
      if (!contactId) {
        contactId = await this.contacts.findExisting(scope, normalized.lead);
        if (contactId) outcome.contactAction = 'matched';
        else if (
          form.destination.createContact &&
          FormLeadContactResolver.hasEnoughData(normalized.lead)
        ) {
          contactId = await this.contacts.create(scope, normalized.lead, {
            formName: form.name,
            ownerUserId: form.destination.ownerUserId,
          });
          outcome.contactAction = 'created';
        } else outcome.contactAction = 'skipped';
        submission.contactId = contactId;
      }

      const description = buildOpportunityDescription(
        form,
        submission,
        normalized,
      );
      const existingId = contactId
        ? await this.findRecentOpenOpportunity(form, contactId)
        : null;
      if (existingId) {
        await this.appendToExisting(form, existingId, submission, description);
        submission.opportunityId = existingId;
        submission.outcome = { ...outcome, opportunityAction: 'appended' };
        return this.finish(submission, 'duplicate');
      }

      submission.opportunityId = await this.createOpportunity(
        form,
        submission,
        normalized,
        contactId,
        description,
      );
      submission.outcome = { ...outcome, opportunityAction: 'created' };
      return this.finish(
        submission,
        contactId || normalized.lead.email || normalized.lead.phone
          ? 'accepted'
          : 'needs_review',
      );
    } catch (error) {
      this.logger.warn(
        `Form ${form.id} submission ${submission.id} failed: ${(error as Error).message}`,
      );
      return this.finish(
        submission,
        'failed',
        (error as Error).message?.slice(0, 1000) ?? 'Unknown error',
      );
    }
  }

  private async finish(
    submission: FormSubmissionEntity,
    status: FormSubmissionEntity['status'],
    error: string | null = null,
  ) {
    submission.status = status;
    submission.error = error;
    submission.processedAt = new Date();
    return this.submissions.save(submission);
  }

  private title(form: FormEntity, normalized: NormalizedSubmission) {
    const who =
      normalized.lead.name ??
      normalized.lead.email ??
      normalized.lead.phone ??
      'Lead';
    return (normalized.opportunity.title ?? `${who} — ${form.name}`).slice(
      0,
      200,
    );
  }

  private metadata(form: FormEntity, submission: FormSubmissionEntity) {
    return {
      formId: form.id,
      formName: form.name,
      formSubmissionId: submission.id,
      formSource: submission.source,
      attribution: submission.attribution ?? {},
    };
  }

  private async createOpportunity(
    form: FormEntity,
    submission: FormSubmissionEntity,
    normalized: NormalizedSubmission,
    contactId: string | null,
    description: string,
  ): Promise<string> {
    const destination = form.destination;
    if (destination.target === 'leadflow_crm') {
      const saved = await this.crm.createOpportunity(
        formRequestContext(form),
        {
          title: this.title(form, normalized),
          description,
          pipelineId: destination.pipelineId ?? undefined,
          stageId: destination.stageId ?? undefined,
          contactId: contactId ?? undefined,
          contactName: normalized.lead.name ?? undefined,
          contactEmail: normalized.lead.email ?? undefined,
          contactPhone: normalized.lead.phone ?? undefined,
          // numeric column: the CRM DTO carries it as a decimal string.
          valueAmount:
            normalized.opportunity.valueAmount === null
              ? undefined
              : normalized.opportunity.valueAmount.toFixed(2),
          source: 'form',
          assignedUserId: destination.ownerUserId ?? undefined,
          metadata: this.metadata(form, submission),
        },
        {
          idempotencyKey: `form-submission:${submission.id}`,
          actor: { type: 'system', userId: null },
        },
      );
      return saved.id;
    }

    const saved = await this.sales.createQuickOpportunity(
      { tenantId: form.tenantId, workspaceId: form.workspaceId },
      {
        title: this.title(form, normalized),
        description,
        pipelineId: destination.pipelineId ?? undefined,
        stageId: destination.stageId ?? undefined,
        contactId: contactId ?? undefined,
        ownerUserId: destination.ownerUserId ?? undefined,
        amountCents:
          normalized.opportunity.valueAmount === null
            ? undefined
            : Math.round(normalized.opportunity.valueAmount * 100),
        // The Agency CRM shows `metadata.source`; "Formulário" is one of its default sources.
        metadata: { source: 'Formulário', ...this.metadata(form, submission) },
      },
    );
    return saved.id;
  }

  /** D-F10: an open opportunity of the same contact in the same pipeline within the window gets the new submission instead. */
  private async findRecentOpenOpportunity(
    form: FormEntity,
    contactId: string,
  ): Promise<string | null> {
    const days = form.destination.duplicateWindowDays;
    if (!days) return null;
    const since = new Date(Date.now() - days * 86_400_000);
    if (form.destination.target === 'leadflow_crm') {
      const client = Boolean(form.agencyClientId && form.companyContextId);
      const found = await this.crmOpportunities.findOne({
        where: {
          tenantId: form.tenantId,
          workspaceId: form.workspaceId,
          contactId,
          status: 'open',
          deletedAt: IsNull(),
          createdAt: MoreThanOrEqual(since),
          agencyClientId: client ? form.agencyClientId! : IsNull(),
          companyContextId: client ? form.companyContextId! : IsNull(),
          ...(form.destination.pipelineId
            ? { pipelineId: form.destination.pipelineId }
            : {}),
        },
        order: { createdAt: 'DESC' },
      });
      return found?.id ?? null;
    }
    const found = await this.salesOpportunities.findOne({
      where: {
        tenantId: form.tenantId,
        workspaceId: form.workspaceId,
        contactId,
        status: 'open',
        createdAt: MoreThanOrEqual(since),
        ...(form.destination.pipelineId
          ? { pipelineId: form.destination.pipelineId }
          : {}),
      },
      order: { createdAt: 'DESC' },
    });
    return found?.id ?? null;
  }

  private async appendToExisting(
    form: FormEntity,
    opportunityId: string,
    submission: FormSubmissionEntity,
    description: string,
  ) {
    const title = `Novo envio do formulário "${form.name}"`.slice(0, 200);
    if (form.destination.target === 'leadflow_crm') {
      await this.crmCommands.recordEvent(
        formRequestContext(form),
        opportunityId,
        {
          eventType: 'form_resubmitted',
          title,
          description,
          actor: { type: 'system', userId: null },
          idempotencyKey: `form-submission:${submission.id}`,
          metadata: this.metadata(form, submission),
        },
      );
      return;
    }
    await this.sales.createOpportunityActivity(
      { tenantId: form.tenantId, workspaceId: form.workspaceId },
      opportunityId,
      {
        type: 'follow_up',
        title,
        description,
        assignedUserId: form.destination.ownerUserId,
      },
    );
  }
}
