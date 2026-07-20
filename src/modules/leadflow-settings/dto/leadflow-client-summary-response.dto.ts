import type { AgencyClient } from '../../clients/entities';
import type { LeadFlowClientSettingsEntity } from '../entities';
import type { LeadFlowSettingsStatus } from '../enums/leadflow-settings-status.enum';

export type LeadFlowClientSummaryResponse = {
  agencyClientId: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
  managedTenantId: string | null;
  leadflow: {
    configured: boolean;
    settingsId: string | null;
    status: LeadFlowSettingsStatus | null;
    businessModeKey: string | null;
    planKey: string | null;
  };
};

export type LeadFlowClientSummaryListResponse = {
  items: LeadFlowClientSummaryResponse[];
  total: number;
  limit: number;
  offset: number;
};

export function mapLeadFlowClientSummaryResponse(
  agencyClient: AgencyClient,
  settings?: LeadFlowClientSettingsEntity | null,
): LeadFlowClientSummaryResponse {
  // Avatar do cliente persistido no módulo Clients do Agency
  // (agency_clients.metadata.contactAvatarUrl).
  const contactAvatarUrl = agencyClient.metadata?.contactAvatarUrl;

  return {
    agencyClientId: agencyClient.id,
    displayName: agencyClient.displayName,
    avatarUrl:
      typeof contactAvatarUrl === 'string' && contactAvatarUrl.trim()
        ? contactAvatarUrl
        : null,
    status: agencyClient.status,
    managedTenantId: agencyClient.managedTenantId,
    leadflow: {
      configured: Boolean(settings),
      settingsId: settings?.id ?? null,
      status: settings?.status ?? null,
      businessModeKey: settings?.businessModeKey ?? null,
      planKey: settings?.planKey ?? null,
    },
  };
}
