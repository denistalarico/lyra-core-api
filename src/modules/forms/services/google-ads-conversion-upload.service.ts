import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SocialAdCredentialError } from '../../social-integrations/credentials/social-ad-credential.error';
import { SocialAdCredentialResolver } from '../../social-integrations/credentials/social-ad-credential.resolver';
import { GoogleAdsMutationClient } from '../../social-integrations/services/google-ads-mutation.client';
import { SocialAdConnectionService } from '../../social-integrations/services/social-ad-connection.service';
import { GoogleAdsError } from '../../social-integrations/sync/google-ads-error';
import type { UpdateGoogleAdsConversionUploadDto } from '../dto/google-ads-conversion-upload.dto';
import { GoogleAdsConversionUploadEntity } from '../entities/google-ads-conversion-upload.entity';
import { GoogleAdsConversionUploadSettingsEntity } from '../entities/google-ads-conversion-upload-settings.entity';
import {
  type QualifiedStageGroup,
  leadflowScopeOf,
  listQualifiedStages,
} from '../crm-qualified-stages';
import { CONVERSION_ACTION_RESOURCE } from '../google-ads-conversion.rules';

export { leadflowScopeOf };

export type GoogleAdsConversionScope = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId: string | null;
};

/** §5.4 contract, plus `connectionId`, `available` and `updatedAt` (additive). */
export type GoogleAdsConversionUploadView = {
  connectionId: string;
  available: boolean;
  enabled: boolean;
  qualifiedActionResource: string | null;
  wonActionResource: string | null;
  sendValue: boolean;
  updatedAt: string | null;
};

export type GoogleAdsConversionActionView = {
  resourceName: string;
  id: string;
  name: string;
  category: string | null;
  primaryForGoal: boolean | null;
  /** True = Google ignores the value sent (UI: "use the same value"). */
  alwaysUseDefaultValue: boolean | null;
  defaultValue: number | null;
  defaultCurrencyCode: string | null;
};

/** The stages classified as qualified (read-only here; set on each CRM). */
export type GoogleAdsConversionStageGroup = QualifiedStageGroup;

/** `fields/v25/conversion_action` (checked 2026-11-20). Only ids, no user text. */
const CONVERSION_ACTIONS_GAQL = `SELECT conversion_action.resource_name, conversion_action.id, conversion_action.name, conversion_action.category, conversion_action.primary_for_goal, conversion_action.value_settings.default_value, conversion_action.value_settings.always_use_default_value, conversion_action.value_settings.default_currency_code FROM conversion_action WHERE conversion_action.type = 'UPLOAD_CLICKS' AND conversion_action.status = 'ENABLED'`;

export function conversionUploadsAvailable(): boolean {
  return process.env.SOCIAL_GOOGLE_ADS_CONVERSION_UPLOAD_ENABLED === 'true';
}

/**
 * GA-CONV settings and reads for the "Enviar conversões ao Google" panel
 * (§5.4). The upload itself is `GoogleAdsConversionUploadWorker`.
 */
@Injectable()
export class GoogleAdsConversionUploadService {
  constructor(
    @InjectRepository(GoogleAdsConversionUploadSettingsEntity, 'agency')
    private readonly settings: Repository<GoogleAdsConversionUploadSettingsEntity>,
    @InjectRepository(GoogleAdsConversionUploadEntity, 'agency')
    private readonly uploads: Repository<GoogleAdsConversionUploadEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly connections: SocialAdConnectionService,
    private readonly credentials: SocialAdCredentialResolver,
    private readonly googleAds: GoogleAdsMutationClient,
  ) {}

  async get(
    scope: GoogleAdsConversionScope,
    connectionId: string,
  ): Promise<GoogleAdsConversionUploadView> {
    await this.requireConnection(scope, connectionId);
    const row = await this.settings.findOne({
      where: {
        connectionId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
      },
    });
    return this.view(connectionId, row);
  }

  /** Absent fields stay as they are; `null` clears an action. */
  async update(
    scope: GoogleAdsConversionScope,
    userId: string | null,
    dto: UpdateGoogleAdsConversionUploadDto,
  ): Promise<GoogleAdsConversionUploadView> {
    await this.requireConnection(scope, dto.connectionId);
    const current =
      (await this.settings.findOne({
        where: {
          connectionId: dto.connectionId,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
        },
      })) ??
      this.settings.create({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        connectionId: dto.connectionId,
        enabled: false,
        qualifiedActionResource: null,
        wonActionResource: null,
        sendValue: true,
        createdById: userId,
      });

    const next = {
      enabled: dto.enabled ?? current.enabled,
      qualifiedActionResource:
        dto.qualifiedActionResource !== undefined
          ? dto.qualifiedActionResource
          : current.qualifiedActionResource,
      wonActionResource:
        dto.wonActionResource !== undefined
          ? dto.wonActionResource
          : current.wonActionResource,
      sendValue: dto.sendValue ?? current.sendValue,
    };

    for (const resource of [
      next.qualifiedActionResource,
      next.wonActionResource,
    ]) {
      if (resource !== null && !CONVERSION_ACTION_RESOURCE.test(resource))
        throw new UnprocessableEntityException('conversion_action_invalid');
    }
    if (
      next.enabled &&
      !next.qualifiedActionResource &&
      !next.wonActionResource
    )
      throw new UnprocessableEntityException('conversion_action_required');
    // "Qualified" is the class of the stage, set on each CRM's stage screen.
    // Choosing the action without any such stage would never send anything.
    if (dto.qualifiedActionResource && (await this.stages(scope)).length === 0)
      throw new UnprocessableEntityException('qualified_stage_required');

    Object.assign(current, next, { updatedById: userId });
    const saved = await this.settings.save(current);
    return this.view(dto.connectionId, saved);
  }

  /** Stages classified as qualified, both CRMs (`crm-qualified-stages.ts`). */
  stages(
    scope: GoogleAdsConversionScope,
  ): Promise<GoogleAdsConversionStageGroup[]> {
    return listQualifiedStages(this.dataSource, scope);
  }

  /** Live list of the account's `UPLOAD_CLICKS` actions (1 Google Ads operation). */
  async conversionActions(
    scope: GoogleAdsConversionScope,
    connectionId: string,
  ): Promise<GoogleAdsConversionActionView[]> {
    await this.requireConnection(scope, connectionId);
    try {
      const credential = await this.credentials.resolve({
        connectionId,
        ...scope,
      });
      const rows = await this.googleAds.search(
        credential,
        CONVERSION_ACTIONS_GAQL,
      );
      return rows.flatMap((row) => {
        const action = record(row.conversionAction);
        const resourceName = text(action.resourceName);
        const id = text(action.id);
        if (
          !resourceName ||
          !id ||
          !CONVERSION_ACTION_RESOURCE.test(resourceName)
        )
          return [];
        const value = record(action.valueSettings);
        return [
          {
            resourceName,
            id,
            name: (text(action.name) ?? id).slice(0, 200),
            category: text(action.category),
            primaryForGoal: bool(action.primaryForGoal),
            alwaysUseDefaultValue: bool(value.alwaysUseDefaultValue),
            defaultValue:
              typeof value.defaultValue === 'number'
                ? value.defaultValue
                : null,
            defaultCurrencyCode: text(value.defaultCurrencyCode),
          },
        ];
      });
    } catch (error) {
      if (error instanceof SocialAdCredentialError)
        throw new UnprocessableEntityException(error.code);
      if (error instanceof GoogleAdsError)
        throw error.kind === 'auth' || error.kind === 'permanent'
          ? new UnprocessableEntityException(error.code)
          : new ServiceUnavailableException(error.code);
      throw error;
    }
  }

  async history(
    scope: GoogleAdsConversionScope,
    connectionId: string,
    limit: number,
  ) {
    await this.requireConnection(scope, connectionId);
    const rows = await this.uploads.find({
      where: {
        connectionId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
      },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    // The click id stays server-side: the panel needs state, not identifiers.
    return rows.map((row) => ({
      id: row.id,
      crm: row.crm,
      opportunityId: row.opportunityId,
      kind: row.kind,
      status: row.status,
      attempts: row.attempts,
      conversionAction: row.conversionAction,
      conversionAt: row.conversionAt.toISOString(),
      conversionValue:
        row.conversionValue === null ? null : Number(row.conversionValue),
      currencyCode: row.currencyCode,
      errorCode: row.errorCode,
      nextAttemptAt:
        row.status === 'pending' ? row.nextAttemptAt.toISOString() : null,
      uploadedAt: row.uploadedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private async requireConnection(
    scope: GoogleAdsConversionScope,
    connectionId: string,
  ) {
    const connection = (await this.connections.list(scope)).find(
      (candidate) => candidate.id === connectionId,
    );
    if (!connection) throw new NotFoundException('connection_not_found');
    if (connection.provider !== 'google_ads')
      throw new UnprocessableEntityException('connection_not_google_ads');
    return connection;
  }

  private view(
    connectionId: string,
    row: GoogleAdsConversionUploadSettingsEntity | null,
  ): GoogleAdsConversionUploadView {
    return {
      connectionId,
      available: conversionUploadsAvailable(),
      enabled: row?.enabled ?? false,
      qualifiedActionResource: row?.qualifiedActionResource ?? null,
      wonActionResource: row?.wonActionResource ?? null,
      sendValue: row?.sendValue ?? true,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
