import {
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  SmsWebhookRejectedError,
  type SmsWebhookHeaders,
} from './sms-provider.adapter';
import { SmsWebhookService } from './sms-webhook.service';

/**
 * Public Telnyx webhook (§3.5). Authenticated by the Ed25519 signature over
 * the exact bytes received (`rawBody: true` in main.ts), never by the parsed
 * body. The failover URL is the same handler.
 */
@Controller('inbox/channels/sms/telnyx/webhook')
export class SmsWebhookController {
  constructor(private readonly webhook: SmsWebhookService) {}

  @Post()
  @HttpCode(200)
  receive(
    @Headers() headers: SmsWebhookHeaders,
    @Req() request: RawBodyRequest<Request>,
  ) {
    return this.handle(headers, request, false);
  }

  @Post('failover')
  @HttpCode(200)
  receiveFailover(
    @Headers() headers: SmsWebhookHeaders,
    @Req() request: RawBodyRequest<Request>,
  ) {
    return this.handle(headers, request, true);
  }

  private async handle(
    headers: SmsWebhookHeaders,
    request: RawBodyRequest<Request>,
    failover: boolean,
  ) {
    try {
      return await this.webhook.handle({
        provider: 'telnyx',
        headers,
        rawBody: request.rawBody,
        failover,
      });
    } catch (error) {
      if (error instanceof SmsWebhookRejectedError) {
        throw new UnauthorizedException('Invalid SMS webhook signature.');
      }
      throw error;
    }
  }
}
