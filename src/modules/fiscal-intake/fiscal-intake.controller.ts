import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { getFinanceContext } from '../finance/services/finance-context';
import { PermissionsGuard, RequirePermission } from '../permissions';
import {
  CreateFiscalIntakeRequestDto,
  InspectFiscalCertificateDto,
  RejectFiscalIntakeDto,
  SubmitFiscalIntakeDto,
} from './fiscal-intake.dto';
import {
  FISCAL_MANAGE_PERMISSION,
  FiscalIntakeService,
} from './fiscal-intake.service';
import { FISCAL_CERTIFICATE_MAX_BYTES } from './fiscal-intake.types';

/** Settings > Finance > Fiscal: the same permission that already guards the fiscal profile. */
@Controller('agency/finance/fiscal-intake')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FiscalIntakeController {
  constructor(private readonly intake: FiscalIntakeService) {}

  @Get()
  @RequirePermission(FISCAL_MANAGE_PERMISSION)
  overview(@Req() req: Request) {
    return this.intake.overview(getFinanceContext(req));
  }

  @Post('requests')
  @RequirePermission(FISCAL_MANAGE_PERMISSION)
  create(@Req() req: Request, @Body() dto: CreateFiscalIntakeRequestDto) {
    return this.intake.createRequest(getFinanceContext(req), dto);
  }

  @Post('requests/:id/revoke')
  @RequirePermission(FISCAL_MANAGE_PERMISSION)
  revoke(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.intake.revokeRequest(getFinanceContext(req), id);
  }

  @Post('requests/:id/approve')
  @RequirePermission(FISCAL_MANAGE_PERMISSION)
  approve(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.intake.approve(getFinanceContext(req), id);
  }

  @Post('requests/:id/reject')
  @RequirePermission(FISCAL_MANAGE_PERMISSION)
  reject(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectFiscalIntakeDto,
  ) {
    return this.intake.reject(getFinanceContext(req), id, dto.note);
  }
}

const CERTIFICATE_UPLOAD = {
  storage: memoryStorage(),
  limits: {
    fileSize: FISCAL_CERTIFICATE_MAX_BYTES,
    files: 1,
    fields: 6,
    fieldSize: 100_000,
    parts: 8,
  },
};

/**
 * The accountant's link (`/f/fiscal/<token>`). No session: the token is the
 * credential. `/api/public/*` is rate limited per IP at the edge (lyra_public)
 * and the service caps attempts per link. Multipart only, 50 KB per file.
 */
@Controller('public/fiscal-intake')
export class PublicFiscalIntakeController {
  constructor(private readonly intake: FiscalIntakeService) {}

  @Get(':token')
  @Header('Cache-Control', 'no-store')
  view(@Param('token') token: string) {
    return this.intake.publicView(token);
  }

  @Post(':token/certificate/inspect')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(FileInterceptor('certificate', CERTIFICATE_UPLOAD))
  inspect(
    @Param('token') token: string,
    @Body() dto: InspectFiscalCertificateDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.intake.inspectPublic(
      token,
      file,
      dto.certificatePassword,
      dto.cnpj,
    );
  }

  @Post(':token')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(FileInterceptor('certificate', CERTIFICATE_UPLOAD))
  submit(
    @Param('token') token: string,
    @Body() dto: SubmitFiscalIntakeDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.intake.submitPublic(token, dto, file);
  }
}
