import { Injectable, NotFoundException } from '@nestjs/common';
import type { RequestContext } from '../../common/context/request-context.interface';
import { toCompanyAwareScope } from '../client-area/client-area-scope';
import type { ClientAreaContext } from '../client-area/client-area.types';
import type { ClientAreaCompanyScope } from '../client-area/client-area-company-hooks.registry';
import { SOCIAL_METRIC_CATALOG } from '../../common/analytics-contracts/social-metric.catalog';
import {
  ClientAreaSourcesRegistry,
  AnalyticsSourceUnavailable,
  type AnalyticsReadQuery,
} from './client-area-sources.registry';
import { metricById, metricAvailable } from './client-area-layout.contract';
import { ClientAreaDashboardsService } from './client-area-dashboards.service';
@Injectable()
export class ClientAreaMetricDataService {
  constructor(
    private readonly sources: ClientAreaSourcesRegistry,
    private readonly dashboards: ClientAreaDashboardsService,
  ) {}
  async read(
    scope: ClientAreaCompanyScope,
    userId: string,
    id: string,
    query: AnalyticsReadQuery,
    context?: ClientAreaContext,
    agencyContext?: RequestContext,
  ) {
    if (context) {
      const trusted = toCompanyAwareScope(context);
      if (Object.keys(trusted).some((key) => trusted[key] !== scope[key]))
        throw new NotFoundException();
    }
    await this.dashboards.assertCompany(scope);
    const metric = metricById(id);
    if (!metric) throw new NotFoundException('Metric not found.');
    if (context && !metricAvailable(context, metric))
      return {
        status: 'unavailable' as const,
        reason: 'module_unavailable',
        metric: id,
      };
    if (id.startsWith('social.')) {
      const canonical = SOCIAL_METRIC_CATALOG.find(
        (m) => `social.${m.id}` === id,
      );
      if (canonical && canonical.availability !== 'available')
        return {
          status: 'unavailable' as const,
          reason: canonical.availability,
          metric: id,
        };
    }
    try {
      const key = id.startsWith('agency.') ? id : `metric.${metric.source}`;
      return {
        status: 'available' as const,
        metric: id,
        metadata: {
          unit: metric.unit,
          additive: metric.additive,
          grain: metric.grain,
        },
        data: await this.sources
          .get(key)
          .read({ scope, userId, context, agencyContext, metric, query }),
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      return {
        status: 'unavailable' as const,
        reason:
          error instanceof AnalyticsSourceUnavailable
            ? error.reason
            : 'source_failed',
        metric: id,
      };
    }
  }
}
