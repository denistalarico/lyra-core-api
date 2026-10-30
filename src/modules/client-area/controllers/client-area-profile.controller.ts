import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Injectable,
  NestInterceptor,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { catchError, throwError } from 'rxjs';
import { CLIENT_AREA_ERROR_CODES, type ClientAreaRequest } from '../client-area.types';
import type { PatchClientAreaProfileDto } from '../dto/client-area-profile.dto';
import {
  ClientAreaAuthGuard,
  ClientAreaEnabledGuard,
} from '../guards/client-area.guards';
import { ClientAreaProfileService } from '../services/client-area-profile.service';

const MAX_CLIENT_AREA_AVATAR_BYTES = 2 * 1024 * 1024;
function invalidProfile(message = 'Invalid Client Area profile input.') {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message,
    code: CLIENT_AREA_ERROR_CODES.invalidProfile,
  });
}

function parseProfile(input: unknown): PatchClientAreaProfileDto {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalidProfile();
  }
  const body = input as Record<string, unknown>;
  if (
    Object.keys(body).some(
      (key) => !['displayName', 'jobTitle', 'phone'].includes(key),
    )
  ) {
    throw invalidProfile();
  }
  if (
    body.displayName !== undefined &&
    (typeof body.displayName !== 'string' ||
      body.displayName.trim().length < 2 ||
      body.displayName.trim().length > 120)
  ) {
    throw invalidProfile();
  }
  if (
    body.jobTitle !== undefined &&
    body.jobTitle !== null &&
    (typeof body.jobTitle !== 'string' || body.jobTitle.trim().length > 80)
  ) {
    throw invalidProfile();
  }
  if (
    body.phone !== undefined &&
    body.phone !== null &&
    body.phone !== '' &&
    (typeof body.phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(body.phone))
  ) {
    throw invalidProfile();
  }
  return body as PatchClientAreaProfileDto;
}

const AVATAR_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_CLIENT_AREA_AVATAR_BYTES },
  fileFilter: (
    _request: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      callback(invalidProfile('Use PNG, JPG or WebP.') as unknown as Error, false);
      return;
    }
    callback(null, true);
  },
};

@Injectable()
class ClientAreaAvatarErrorInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof HttpException && [400, 413].includes(error.getStatus())) {
          return throwError(() => invalidProfile('Invalid avatar upload.'));
        }
        return throwError(() => error);
      }),
    );
  }
}

@Controller('client-area/me/profile')
@UseGuards(ClientAreaEnabledGuard, ClientAreaAuthGuard)
export class ClientAreaProfileController {
  constructor(private readonly profiles: ClientAreaProfileService) {}

  @Get()
  get(@Req() req: ClientAreaRequest) {
    return this.profiles.get(req.clientAreaIdentity!);
  }

  @Patch()
  patch(
    @Req() req: ClientAreaRequest,
    @Body() input: unknown,
  ) {
    return this.profiles.patch(req.clientAreaIdentity!, parseProfile(input));
  }

  @Post('avatar')
  @UseInterceptors(
    new ClientAreaAvatarErrorInterceptor(),
    FileInterceptor('file', AVATAR_UPLOAD_OPTIONS),
  )
  uploadAvatar(
    @Req() req: ClientAreaRequest,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw invalidProfile('Missing multipart field "file".');
    return this.profiles.uploadAvatar(req.clientAreaIdentity!, file);
  }

  @Delete('avatar')
  removeAvatar(@Req() req: ClientAreaRequest) {
    return this.profiles.removeAvatar(req.clientAreaIdentity!);
  }

  @Get('avatar')
  async avatar(@Req() req: ClientAreaRequest, @Res() res: Response) {
    const file = await this.profiles.readAvatar(req.clientAreaIdentity!);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    file.body.pipe(res);
  }
}
