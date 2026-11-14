import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import { Ga4SyncBodyDto } from './dto/ga4-query.dto';
import { Ga4SyncService } from './ga4-sync.service';

/** Connecting and syncing administer the integration: agency admin only. */
const SOCIAL_INTEGRATIONS_PERMISSION =
  'social.settings.integrations.manage.admin';

@Controller('social/integrations/google/ga4')
export class Ga4SyncController {
  constructor(private readonly sync: Ga4SyncService) {}

  /** Short window, validated, locked per property and window; kill switch D-G8. */
  @Post('sync')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  async run(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: Ga4SyncBodyDto,
  ) {
    const result = await this.sync.syncProperty({
      scope: resolveCompanyAwareScope(ctx),
      propertyId: dto.propertyId,
      trigger: 'manual',
      windowStart: dto.since,
      windowEnd: dto.until,
    });
    this.sync.throwIfActionable(result);
    return result;
  }
}
