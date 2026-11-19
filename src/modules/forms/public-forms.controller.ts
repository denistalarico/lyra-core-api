import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CapturePublicFormDto, SubmitPublicFormDto } from './dto/forms.dto';
import { FormGoogleAdsLeadsService } from './services/form-google-ads-leads.service';
import { FormsService } from './services/forms.service';

/**
 * Unauthenticated routes used by the public page, the embed (F2) and the
 * capture script (F3). `/api/public/*` is already rate limited per IP at the
 * edge (lyra_public, 120 r/m); the service adds a per-form/visitor cap.
 */
@Controller('public/forms')
export class PublicFormsController {
  constructor(
    private readonly forms: FormsService,
    private readonly googleAdsLeads: FormGoogleAdsLeadsService,
  ) {}

  @Get(':publicKey')
  @Header('Cache-Control', 'no-store')
  getConfig(@Param('publicKey') publicKey: string) {
    return this.forms.getPublicConfig(publicKey);
  }

  @Post(':publicKey/submissions')
  @HttpCode(200)
  submit(
    @Param('publicKey') publicKey: string,
    @Body() dto: SubmitPublicFormDto,
    @Req() req: Request,
    @Headers('user-agent') userAgent?: string,
  ) {
    // `trust proxy` is loopback (main.ts): req.ip is the visitor behind nginx.
    return this.forms.submitPublic(publicKey, dto, {
      ip: req.ip ?? null,
      userAgent: userAgent ?? null,
    });
  }

  /**
   * capture.js (F3) via sendBeacon: urlencoded `payload`, no preflight and no
   * CORS headers needed (the script never reads the answer).
   */
  @Post(':publicKey/captures')
  @HttpCode(204)
  async capture(
    @Param('publicKey') publicKey: string,
    @Body() dto: CapturePublicFormDto,
    @Req() req: Request,
    @Headers('user-agent') userAgent?: string,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
  ): Promise<void> {
    await this.forms.capturePublic(publicKey, dto, {
      ip: req.ip ?? null,
      userAgent: userAgent ?? null,
      origin: origin ?? null,
      referer: referer ?? null,
    });
  }

  /**
   * GL1: Google Ads lead-form webhook. Auth is the key in the body (`google_key`),
   * not a user; the raw body is read by hand because the parser must ignore
   * fields Google adds (the global pipe rejects unknown properties).
   * 200 `{}` is what Google expects; 4XX is not retried, 5XX is.
   */
  @Post(':publicKey/google-ads-leads')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  receiveGoogleAdsLead(
    @Param('publicKey') publicKey: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.googleAdsLeads.receive(publicKey, body);
  }
}
