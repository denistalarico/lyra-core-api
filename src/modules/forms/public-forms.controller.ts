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
import { SubmitPublicFormDto } from './dto/forms.dto';
import { FormsService } from './services/forms.service';

/**
 * Unauthenticated routes used by the public page, the embed (F2) and the
 * capture script (F3). `/api/public/*` is already rate limited per IP at the
 * edge (lyra_public, 120 r/m); the service adds a per-form/visitor cap.
 */
@Controller('public/forms')
export class PublicFormsController {
  constructor(private readonly forms: FormsService) {}

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
}
