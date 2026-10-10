import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../../permissions';
import { ContractAiAssistDto } from './contract-ai-assist.dto';
import { ContractAiAssistService } from './contract-ai-assist.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/contracts/templates/ai-assist')
export class ContractAiAssistController {
  constructor(private readonly service: ContractAiAssistService) {}

  @Post()
  @HttpCode(200)
  @RequirePermission('agency.contracts.templates.manage.admin')
  assist(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: ContractAiAssistDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.service.assist(context, dto, idempotencyKey);
  }
}
