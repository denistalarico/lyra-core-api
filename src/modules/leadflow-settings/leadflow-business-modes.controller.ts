import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import {
  LeadFlowBusinessModeTemplateDetailResponse,
  LeadFlowBusinessModeTemplateListResponse,
  mapBusinessModeTemplateDetail,
  mapBusinessModeTemplateSummary,
} from './dto/leadflow-business-mode-template-response.dto';
import { LeadFlowBusinessModeTemplateService } from './services/leadflow-business-mode-template.service';

@Controller('leadflow/business-modes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
@RequirePermission('leadflow.settings.general.view.admin')
export class LeadFlowBusinessModesController {
  constructor(
    private readonly businessModeTemplateService: LeadFlowBusinessModeTemplateService,
  ) {}

  @Get()
  async listBusinessModes(
    @RequestContextData() ctx: RequestContext,
  ): Promise<LeadFlowBusinessModeTemplateListResponse> {
    const templates = await this.businessModeTemplateService.listTemplates(ctx);

    return {
      items: templates.map(mapBusinessModeTemplateSummary),
    };
  }

  @Get(':key')
  async getBusinessMode(
    @RequestContextData() ctx: RequestContext,
    @Param('key') key: string,
  ): Promise<LeadFlowBusinessModeTemplateDetailResponse> {
    const template = await this.businessModeTemplateService.getTemplateByKey(
      ctx,
      key,
    );

    return mapBusinessModeTemplateDetail(template);
  }
}
