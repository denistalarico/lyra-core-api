import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { LeadFlowBusinessModeTemplateEntity } from '../../leadflow-settings/entities';
import { LeadFlowSettingsStatus } from '../../leadflow-settings/enums/leadflow-settings-status.enum';
import {
  businessModeFieldSpecs,
  CRM_CORE_OPPORTUNITY_FIELDS,
  CRM_LEAD_SCORE_FIELDS,
  isAddressableOpportunityField,
  type CrmOpportunityFieldSpec,
} from '../catalog/crm-opportunity-field.catalog';

const AGENCY_CONNECTION = 'agency';

export interface CrmOpportunityFieldCatalog {
  businessModeKey: string | null;
  /**
   * Null when the Business Mode has no template, so the caller can say "this
   * client has no qualification fields configured" instead of showing an empty
   * list that looks like a complete answer.
   */
  businessModeResolved: boolean;
  fields: CrmOpportunityFieldSpec[];
}

/**
 * Resolves which opportunity fields exist for a given Business Mode.
 *
 * Core fields are the same everywhere; qualification fields come from the
 * client's Business Mode template, which is where an operator already declared
 * what they need to know about a lead. Reading them from there rather than
 * asking again is what keeps "qualified" meaning one thing across the CRM, the
 * Lead Score and Automations.
 */
@Injectable()
export class CrmOpportunityFieldCatalogService {
  constructor(
    @InjectRepository(LeadFlowBusinessModeTemplateEntity, AGENCY_CONNECTION)
    private readonly templatesRepository: Repository<LeadFlowBusinessModeTemplateEntity>,
  ) {}

  /**
   * Every field policy may offer for this Business Mode.
   *
   * An unknown or absent mode still returns the core fields: they are real and
   * selectable regardless, and refusing to answer would leave the settings page
   * unusable for a client whose mode was never configured.
   */
  async listFields(
    ctx: RequestContext,
    businessModeKey?: string | null,
  ): Promise<CrmOpportunityFieldCatalog> {
    // Lead Score fields are real and selectable in every Business Mode: the
    // score is computed for every opportunity, so a policy may gate on it
    // regardless of which qualification fields the mode declares.
    const core = [...CRM_CORE_OPPORTUNITY_FIELDS, ...CRM_LEAD_SCORE_FIELDS];
    if (!businessModeKey) {
      return {
        businessModeKey: null,
        businessModeResolved: false,
        fields: core,
      };
    }

    const template = await this.findTemplate(ctx, businessModeKey);
    if (!template) {
      return {
        businessModeKey,
        businessModeResolved: false,
        fields: core,
      };
    }

    return {
      businessModeKey,
      businessModeResolved: true,
      fields: [
        ...core,
        ...businessModeFieldSpecs(template.qualificationFields),
      ],
    };
  }

  /**
   * Fields the Business Mode declares as necessary for a qualified lead.
   *
   * This is the definition the Lead Score qualification rule consumes. It is
   * empty when the mode is unknown — and an empty list must never be read as
   * "everything is filled in", which is why callers receive the resolution flag
   * alongside it.
   */
  async essentialFields(
    ctx: RequestContext,
    businessModeKey: string | null,
  ): Promise<{ resolved: boolean; fields: CrmOpportunityFieldSpec[] }> {
    const catalog = await this.listFields(ctx, businessModeKey);
    return {
      resolved: catalog.businessModeResolved,
      fields: catalog.fields.filter((spec) => spec.essential),
    };
  }

  /** Whether policy may reference this key at all. Structural, not scoped. */
  isAddressable(key: string): boolean {
    return isAddressableOpportunityField(key);
  }

  /**
   * Tenant templates win over the official ones, matching how the Business Mode
   * template service resolves elsewhere. Highest version of each.
   */
  private async findTemplate(
    ctx: RequestContext,
    key: string,
  ): Promise<LeadFlowBusinessModeTemplateEntity | null> {
    const scoped = await this.templatesRepository.findOne({
      where: {
        tenantId: ctx.tenantId,
        key: key as LeadFlowBusinessModeTemplateEntity['key'],
        status: LeadFlowSettingsStatus.Active,
        deletedAt: IsNull(),
      },
      order: { version: 'DESC' },
    });
    if (scoped) return scoped;

    return this.templatesRepository.findOne({
      where: {
        tenantId: IsNull(),
        key: key as LeadFlowBusinessModeTemplateEntity['key'],
        status: LeadFlowSettingsStatus.Active,
        deletedAt: IsNull(),
      },
      order: { version: 'DESC' },
    });
  }
}
