import {
  Controller,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ContractsService } from '../services/contracts.service';

// Public endpoint registered in the Autentique panel. No auth guard: the
// settings id in the path resolves the tenant and the request is accepted only
// when `x-autentique-signature` is a valid HMAC of the raw body under that
// tenant's webhook secret. The body is read from `rawBody` (enabled in
// main.ts), never from the re-serialized JSON.
@Controller('agency/contracts/webhooks/autentique')
export class AutentiqueWebhookController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post(':settingsId')
  @HttpCode(200)
  receive(
    @Param('settingsId', new ParseUUIDPipe()) settingsId: string,
    @Headers('x-autentique-signature') signature: string | undefined,
    @Req() request: RawBodyRequest<Request>,
  ) {
    return this.contractsService.handleAutentiqueWebhook(
      settingsId,
      request.rawBody,
      signature,
    );
  }
}
