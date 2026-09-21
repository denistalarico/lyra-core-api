import {
  Body,
  Controller,
  Get,
  HttpException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import { CreateSocialAnalyticsInsightDto } from './dto/social-analytics-insight.dto';
import { SocialAnalyticsInsightError } from './services/social-analytics-insight.errors';
import { SocialAnalyticsInsightService } from './services/social-analytics-insight.service';

/**
 * Generating an insight writes a card into a dashboard and spends money, so it
 * is governed by the same permission as reshaping one — not by the read
 * permission that merely lets someone look at the numbers.
 */
const MANAGE_PERMISSION =
  'social.analytics.dashboards.manage.admin_or_explicit';
const READ_PERMISSION = 'social.analytics.reports.view.operational';

/**
 * "Analisar com Orion" — Etapa 8.
 *
 * A controller of its own rather than a route on the dashboards controller,
 * because the plan puts it at `social/analytics/insights` and that is a sibling
 * of `social/analytics/dashboards`, not a child. It shares the module, since it
 * shares the permission and the scope resolution and nothing else.
 *
 * Nothing is persisted: the generated text becomes an `insight` card in the
 * layout, written through the dashboard PATCH the frontend already uses. Having
 * one write path into `layout` is what keeps the stored contract in one place.
 */
@Controller('social/analytics/insights')
export class SocialAnalyticsInsightsController {
  constructor(private readonly service: SocialAnalyticsInsightService) {}

  /**
   * Whether the button should be offered at all.
   *
   * Read permission, not manage: an operator who cannot generate still needs
   * the page to render, and this answer carries no data — only whether the
   * feature is configured in this environment. Without it the frontend would
   * have to discover a disabled provider by making a request that fails, which
   * is a 503 in the console on every page load.
   */
  @Get('availability')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(READ_PERMISSION)
  availability() {
    return { available: this.service.available };
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(MANAGE_PERMISSION)
  async create(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateSocialAnalyticsInsightDto,
  ) {
    try {
      return await this.service.generate(resolveCompanyAwareScope(ctx), {
        sectionTitle: dto.sectionTitle,
        channelLabel: dto.channelLabel,
        since: dto.since,
        until: dto.until,
        metrics: dto.metrics.map((metric) => ({
          label: metric.label,
          value: metric.value,
          description: metric.description ?? null,
        })),
      });
    } catch (error) {
      // The provider's own codes are mapped here rather than thrown as HTTP
      // from the service: the service is also what a future scheduled report
      // would call, and that caller wants the code, not a status.
      if (error instanceof SocialAnalyticsInsightError) {
        throw new HttpException(
          SocialAnalyticsInsightService.messageFor(error),
          SocialAnalyticsInsightService.statusFor(error),
        );
      }

      throw error;
    }
  }
}
