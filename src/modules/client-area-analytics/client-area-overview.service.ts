import { Injectable, Logger } from '@nestjs/common';
import type {
  ClientAreaContext,
  ClientAreaSelfContext,
} from '../client-area/client-area.types';
import type { RequestContext } from '../../common/context/request-context.interface';
import { toCompanyAwareScope } from '../client-area/client-area-scope';
import {
  AnalyticsSourceUnavailable,
  ClientAreaSourcesRegistry,
} from './client-area-sources.registry';
export const OVERVIEW_SOURCES = [
  'agency.projects',
  'agency.tasks',
  'agency.invoices',
  'agency.contract',
  'social.approvals',
  'social.contents',
  'social.campaign',
  'leadflow.inbox',
  'leadflow.leads',
  'leadflow.appointments',
  'leadflow.kpis',
] as const;
export type OverviewSlice =
  | { status: 'available'; data: unknown }
  | { status: 'unavailable'; reason: string };
@Injectable()
export class ClientAreaOverviewService {
  private readonly logger = new Logger(ClientAreaOverviewService.name);
  constructor(private readonly sources: ClientAreaSourcesRegistry) {}
  async get(context: ClientAreaContext) {
    const scope = toCompanyAwareScope(context);
    return this.readSources(context, scope);
  }
  async getSelf(context: ClientAreaSelfContext) {
    const agencyContext: RequestContext = {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      userId: context.userId,
      sessionId: context.sessionId,
      role: context.agencyRole,
    };
    return this.readSources(context, undefined, agencyContext);
  }
  private async readSources(
    context: ClientAreaContext | ClientAreaSelfContext,
    scope?: ReturnType<typeof toCompanyAwareScope>,
    agencyContext?: RequestContext,
  ) {
    const outcomes = await Promise.allSettled(
      OVERVIEW_SOURCES.map(async (key) => {
        const source = this.sources.get(key);
        if (
          source.ownerOnly &&
          ('agencyRole' in context
            ? context.agencyRole !== 'owner'
            : (context.accountRole ?? context.role) !== 'client_owner')
        )
          return {
            status: 'unavailable',
            reason: 'owner_required',
          } as OverviewSlice;
        if (
          source.modules.some(
            (module) =>
              !context.memberAccess?.[module]?.available ||
              !context.memberAccess[module].level,
          )
        )
          return {
            status: 'unavailable',
            reason: 'module_unavailable',
          } as OverviewSlice;
        try {
          return {
            status: 'available',
            data: await source.read({
              scope,
              userId: context.userId,
              context: 'companyContextId' in context ? context : undefined,
              query: {},
              agencyContext,
            }),
          } as OverviewSlice;
        } catch (error) {
          if (error instanceof AnalyticsSourceUnavailable)
            return {
              status: 'unavailable',
              reason: error.reason,
            } as OverviewSlice;
          throw error;
        }
      }),
    );
    const slices: Record<string, OverviewSlice> = {},
      partialFailures: Array<{ source: string; reason: 'source_failed' }> = [];
    outcomes.forEach((outcome, index) => {
      const source = OVERVIEW_SOURCES[index];
      if (outcome.status === 'fulfilled') slices[source] = outcome.value;
      else {
        slices[source] = { status: 'unavailable', reason: 'source_failed' };
        partialFailures.push({ source, reason: 'source_failed' });
        this.logger.warn(`Client Area overview source unavailable: ${source}`);
      }
    });
    return { generatedAt: new Date().toISOString(), slices, partialFailures };
  }
}
