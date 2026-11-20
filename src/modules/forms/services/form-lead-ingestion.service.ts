import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { AgencySalesService } from '../../agency/agency-sales.service';
import { AgencySalesOpportunityEntity } from '../../agency/entities/agency-sales.entities';
import { CrmService } from '../../crm/crm.service';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { CrmOpportunityCommandService } from '../../crm/services/crm-opportunity-command.service';
import { SocialAdEntity } from '../../social-integrations/entities/social-ad-entity.entity';
import { FormEntity } from '../entities/form.entity';
import { FormSubmissionEntity } from '../entities/form-submission.entity';
import { hasLeadIdentity } from '../form-capture.mapper';
import type {
  FormSubmissionOutcome,
  NormalizedLead,
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
  google_ads: 'formulário do Google Ads',
  meta_lead_ads: 'formulário do Meta Lead Ads',
};

/**
 * Ad-network lead forms (D-L1/D-L6): where the lead is labelled in each CRM and
 * which mirror rows name its campaign. Sources not listed here keep the
 * original behaviour untouched.
 */
type AdLeadSource = {
  /** `social_ad_entities.provider` of the campaign mirror. */
  provider: string;
  /** Agency CRM `metadata.source` (a default opportunity source of that CRM). */
  agencySource: string;
  /** LeadFlow CRM `source` (free string). */
  leadflowSource: string;
};

const AD_LEAD_SOURCES: Partial<
  Record<FormSubmissionEntity['source'], AdLeadSource>
> = {
  google_ads: {
    provider: 'google_ads',
    agencySource: 'Google Ads',
    leadflowSource: 'google_ads',
  },
  meta_lead_ads: {
    provider: 'meta_ads',
    agencySource: 'Meta Ads',
    leadflowSource: 'meta_lead_ads',
  },
};

/**
 * Error text of an ad lead must not carry the lead's own data (PII rule): the
 * values we hold are cut out first, then anything that looks like an e-mail or a phone.
 */
export function scrubLeadPii(message: string, lead: NormalizedLead): string {
  let text = message;
  for (const value of [lead.name, lead.email, lead.phone, lead.company])
    if (value && value.length >= 3)
      text = text.split(value).join('[dado do lead]');
  return text
    .replace(/[^\s@<>"']+@[^\s@<>"']+/g, '[e-mail]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[telefone]');
}

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

/** Agency CRM opportunity keys for the contact (`contactName`, `companyName`, `phone`, `email`). */
export function agencyContactMetadata(
  lead: NormalizedSubmission['lead'],
): Record<string, string> {
  const entries: Array<[string, string | null]> = [
    ['contactName', lead.name],
    ['companyName', lead.company],
    ['phone', lead.phone],
    ['email', lead.email],
  ];
  return Object.fromEntries(
    entries.filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

export function buildOpportunityDescription(
  form: FormEntity,
  submission: Pick<FormSubmissionEntity, 'source' | 'attribution'>,
  normalized: NormalizedSubmission,
  campaignName: string | null = null,
): string {
  const attribution = Object.entries(submission.attribution ?? {})
    .filter(
      ([key]) =>
        key.startsWith('utm_') || key === 'pageUrl' || key === 'referrer',
    )
    .map(([key, value]) => `${key}: ${value}`);
  const campaignId = submission.attribution?.campaignId;
  const origin = AD_LEAD_SOURCES[submission.source]
    ? `Lead recebido pelo ${SOURCE_LABEL[submission.source]}${
        campaignName || campaignId
          ? ` — campanha ${campaignName ?? campaignId}`
          : ''
      }.`
    : `Lead recebido pelo formulário "${form.name}" (${SOURCE_LABEL[submission.source]}).`;
  return [
    origin,
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
    @InjectRepository(SocialAdEntity, 'agency')
    private readonly adEntities: Repository<SocialAdEntity>,
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
    // A captured site form with no recognizable contact field (newsletter,
    // search, unmapped names) waits for the mapping instead of opening a blank deal.
    if (submission.source === 'script' && !hasLeadIdentity(normalized))
      return this.finish(
        submission,
        'needs_review',
        'Nenhum campo de nome, e-mail ou telefone reconhecido. Mapeie os campos na aba Publicação e reprocesse.',
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

      const campaignName = await this.campaignName(form, submission);
      const description = buildOpportunityDescription(
        form,
        submission,
        normalized,
        campaignName,
      );
      const existingId = contactId
        ? await this.findRecentOpenOpportunity(form, contactId)
        : null;
      if (existingId) {
        await this.appendToExisting(
          form,
          existingId,
          submission,
          description,
          campaignName,
        );
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
        campaignName,
      );
      submission.outcome = { ...outcome, opportunityAction: 'created' };
      return this.finish(
        submission,
        contactId || normalized.lead.email || normalized.lead.phone
          ? 'accepted'
          : 'needs_review',
      );
    } catch (error) {
      const raw = (error as Error).message?.slice(0, 1000) ?? 'Unknown error';
      const message = AD_LEAD_SOURCES[submission.source]
        ? scrubLeadPii(raw, normalized.lead)
        : raw;
      this.logger.warn(
        `Form ${form.id} submission ${submission.id} failed: ${message}`,
      );
      return this.finish(submission, 'failed', message);
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

  /** Campaign name from the ad mirror; absent mirror or any failure never blocks the lead (D-L6). */
  private async campaignName(
    form: FormEntity,
    submission: FormSubmissionEntity,
  ): Promise<string | null> {
    const adSource = AD_LEAD_SOURCES[submission.source];
    const campaignId = submission.attribution?.campaignId;
    if (!adSource || !campaignId) return null;
    try {
      const row = await this.adEntities.findOne({
        select: { id: true, name: true },
        where: {
          tenantId: form.tenantId,
          workspaceId: form.workspaceId,
          agencyClientId: form.agencyClientId ?? IsNull(),
          provider: adSource.provider,
          entityLevel: 'campaign',
          externalId: campaignId,
        },
        order: { lastSeenAt: 'DESC' },
      });
      return row?.name?.trim() || null;
    } catch {
      return null;
    }
  }

  private metadata(
    form: FormEntity,
    submission: FormSubmissionEntity,
    campaignName: string | null = null,
  ) {
    const base = {
      formId: form.id,
      formName: form.name,
      formSubmissionId: submission.id,
      formSource: submission.source,
      attribution: submission.attribution ?? {},
    };
    const adSource = AD_LEAD_SOURCES[submission.source];
    if (!adSource) return base;
    // D-L6. `formId` above stays the Lyra form (existing readers use it), so the
    // provider's own form id travels as `providerFormId`.
    const a = submission.attribution ?? {};
    return {
      ...base,
      provider: adSource.provider,
      ...(a.campaignId ? { campaignId: a.campaignId } : {}),
      ...(campaignName ? { campaignName } : {}),
      ...(a.adGroupId ? { adGroupId: a.adGroupId } : {}),
      ...(a.assetGroupId ? { assetGroupId: a.assetGroupId } : {}),
      ...(a.adId ? { adId: a.adId } : {}),
      ...(a.formId ? { providerFormId: a.formId } : {}),
      ...(a.leadId ? { leadId: a.leadId } : {}),
      ...(a.gclid ? { gclid: a.gclid } : {}),
      ...(a.submittedAt ? { submittedAt: a.submittedAt } : {}),
    };
  }

  private async createOpportunity(
    form: FormEntity,
    submission: FormSubmissionEntity,
    normalized: NormalizedSubmission,
    contactId: string | null,
    description: string,
    campaignName: string | null,
  ): Promise<string> {
    const destination = form.destination;
    const adSource = AD_LEAD_SOURCES[submission.source];
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
          source: adSource?.leadflowSource ?? 'form',
          assignedUserId: destination.ownerUserId ?? undefined,
          metadata: this.metadata(form, submission, campaignName),
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
        metadata: {
          source: adSource?.agencySource ?? 'Formulário',
          ...this.metadata(form, submission, campaignName),
          // The Agency card and drawer read the contact from these keys; without
          // them the card falls back to the contact UUID.
          ...agencyContactMetadata(normalized.lead),
        },
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
    campaignName: string | null,
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
          metadata: this.metadata(form, submission, campaignName),
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
