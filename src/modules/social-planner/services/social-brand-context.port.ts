import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities/leadflow-client-settings.entity';
import type { SocialBusinessModeKey } from '../catalog/commemorative-dates.catalog';
import type { SocialPlannerScope } from './social-planner.service';

/**
 * The brand facts the Planner sends to the model, and the two configuration
 * values the commemorative-date picker filters by.
 *
 * Everything here is editorial. No uuid, no contact detail, no credential:
 * `toBrandContext` below decides that once, so "what brand data reaches a paid
 * provider" is answered by reading one function.
 */
export interface SocialBrandContext {
  publicName: string | null;
  legalName: string | null;
  summary: string | null;
  valueProposition: string | null;
  differentiators: string | null;
  targetAudience: string | null;
  regionsServed: string | null;
  mainOffers: string | null;
  preferredCta: string | null;
  conversionGoal: string | null;
  policies: string | null;
  /** ISO 3166-1 alpha-2 when the address carries one, else NULL. */
  country: string | null;
  city: string | null;
  stateRegion: string | null;
  businessMode: SocialBusinessModeKey | null;
}

export const EMPTY_SOCIAL_BRAND_CONTEXT: SocialBrandContext = {
  publicName: null,
  legalName: null,
  summary: null,
  valueProposition: null,
  differentiators: null,
  targetAudience: null,
  regionsServed: null,
  mainOffers: null,
  preferredCta: null,
  conversionGoal: null,
  policies: null,
  country: null,
  city: null,
  stateRegion: null,
  businessMode: null,
};

/**
 * Reads the agency's or client's company context for the Planner.
 *
 * WHY A PORT AND NOT `LeadFlowClientSettingsService`
 * --------------------------------------------------
 * That service is the write path: every read on it takes a `RequestContext` and
 * runs a permission check against it. The Planner needs these facts in two
 * places where no request exists — inside the generation worker, minutes after
 * the operator left, and while building a prompt in a background transaction.
 * Passing a synthesized `RequestContext` into a permission checker to satisfy a
 * type would be faking an authorization decision, which is worse than reading
 * the row.
 *
 * So this is a deliberately narrow read-only port: one table, one scope filter,
 * no writes, and a return type that exposes only editorial fields. The
 * authorization that matters already happened — the Planner endpoint that
 * enqueued the run checked the operator's permission, and the run carries the
 * scope that check approved.
 *
 * WHY THE PUBLISHED CONTEXT AND NOT THE DRAFT
 * -------------------------------------------
 * The draft is what someone is still editing; the published context is what the
 * agency agreed to say about itself. Generation reads the published one and
 * falls back to the draft only when nothing has been published yet, so a brand
 * new client is not stuck with an empty prompt.
 */
@Injectable()
export class SocialBrandContextPort {
  constructor(
    @InjectRepository(LeadFlowClientSettingsEntity, 'agency')
    private readonly settingsRepository: Repository<LeadFlowClientSettingsEntity>,
  ) {}

  async load(scope: SocialPlannerScope): Promise<SocialBrandContext> {
    const settings = await this.settingsRepository.findOne({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        // A raw null is not a safe TypeORM filter — it matches every row.
        agencyClientId:
          scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
      },
    });

    if (!settings) return EMPTY_SOCIAL_BRAND_CONTEXT;

    const published = asRecord(settings.companyContextPublished);
    const context =
      Object.keys(published).length > 0
        ? published
        : asRecord(settings.companyContextDraft);

    return toBrandContext(context, settings.businessModeKey);
  }
}

/**
 * Projects the company-context blob onto the editorial subset.
 *
 * Exported for the spec: the question "can a phone number reach the prompt" is
 * worth answering without a database.
 */
export function toBrandContext(
  context: Record<string, unknown>,
  businessModeKey: string | null,
): SocialBrandContext {
  const identity = asRecord(context.identity);
  const contact = asRecord(context.contact);
  const address = asRecord(contact.address);
  const qualification = asRecord(context.qualification);

  return {
    publicName: text(identity.publicName),
    legalName: text(identity.legalName),
    summary: text(identity.summary),
    valueProposition: text(identity.valueProposition),
    differentiators: text(identity.differentiators),
    targetAudience: text(identity.targetAudience),
    regionsServed: text(identity.regionsServed),
    mainOffers: text(qualification.priorityServices),
    preferredCta: text(qualification.preferredCta),
    conversionGoal: text(qualification.conversionGoal),
    policies: text(context.policies),
    country: isoCountry(address.country),
    city: text(address.city),
    stateRegion: text(address.stateRegion),
    businessMode: businessMode(businessModeKey),
  };
}

/**
 * The address country is a free-text field that predates the ISO selector, so
 * historical rows hold "Brasil", "brazil" or an empty string. Only a clean
 * alpha-2 code is treated as a country; anything else resolves to NULL, which
 * the date picker reads as "offer everything" rather than as a wrong country.
 */
function isoCountry(value: unknown): string | null {
  const parsed = text(value);
  if (!parsed) return null;
  const upper = parsed.toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : null;
}

function businessMode(value: string | null): SocialBusinessModeKey | null {
  const parsed = text(value);
  return parsed ? (parsed as SocialBusinessModeKey) : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Capped so one long free-text field cannot dominate the prompt budget.
  return trimmed.length > 0 ? trimmed.slice(0, 1_500) : null;
}
