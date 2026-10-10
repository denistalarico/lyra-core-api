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

// Public endpoints registered in the Autentique panel. No auth guard: the
// settings id in the path resolves the tenant and the request is accepted only
// when `x-autentique-signature` is a valid HMAC of the raw body under that
// tenant's secret for the endpoint's category. The body is read from `rawBody`
// (enabled in main.ts), never from the re-serialized JSON.
//
// Autentique registers one webhook per event category, each with its own
// secret, so each category has its own URL: the bare path takes `signature.*`
// (kept as-is for endpoints already registered), `/documents` takes
// `document.finished`.
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
      'signature',
    );
  }

  @Post(':settingsId/documents')
  @HttpCode(200)
  receiveDocument(
    @Param('settingsId', new ParseUUIDPipe()) settingsId: string,
    @Headers('x-autentique-signature') signature: string | undefined,
    @Req() request: RawBodyRequest<Request>,
  ) {
    return this.contractsService.handleAutentiqueWebhook(
      settingsId,
      request.rawBody,
      signature,
      'document',
    );
  }
}
