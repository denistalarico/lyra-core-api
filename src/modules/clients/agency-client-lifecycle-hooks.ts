import { Injectable, Logger } from '@nestjs/common';

export type AgencyClientArchiveEvent = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string;
  actorUserId: string | null;
};
export type CompanyContextArchiveEvent = AgencyClientArchiveEvent & {
  companyContextId: string;
};
export type AgencyClientLifecyclePort = {
  onClientArchived(event: AgencyClientArchiveEvent): Promise<void>;
  onCompanyContextArchived(event: CompanyContextArchiveEvent): Promise<void>;
};

/** Owned by ClientsModule; the joining module registers the adapter at boot (D-09).
 * Hooks run after commit. Archival remains effective if an adapter fails; the
 * hourly reconciler repairs the external access state. Restore has no hook. */
@Injectable()
export class AgencyClientLifecycleHooks {
  private readonly logger = new Logger(AgencyClientLifecycleHooks.name);
  private port: AgencyClientLifecyclePort | null = null;

  register(port: AgencyClientLifecyclePort) {
    this.port = port;
  }

  async onClientArchived(
    event: AgencyClientArchiveEvent,
    requireSuccess = false,
  ): Promise<void> {
    try {
      await this.port?.onClientArchived(event);
    } catch (error) {
      this.logger.error(
        `Client Area archival hook failed for client ${event.agencyClientId}; reconciliation required.`,
      );
      // A restore must not turn failed archival cleanup into renewed access.
      if (requireSuccess) throw error;
    }
  }

  async onCompanyContextArchived(
    event: CompanyContextArchiveEvent,
  ): Promise<void> {
    try {
      await this.port?.onCompanyContextArchived(event);
    } catch {
      this.logger.error(
        `Client Area archival hook failed for company ${event.companyContextId}; reconciliation required.`,
      );
    }
  }
}
