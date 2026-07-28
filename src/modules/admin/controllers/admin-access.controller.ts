import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PLATFORM_ADMIN_PERMISSIONS,
  PLATFORM_ADMIN_ROLE_KEYS,
  PLATFORM_ADMIN_STATUSES,
} from '../types/admin-access.types';

@Controller('admin/access')
export class AdminAccessController {
  constructor(private readonly configService: ConfigService) {}

  @Get('contract')
  getContract() {
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    const explicitlyEnabled =
      this.configService.get<string>('ADMIN_CONTRACT_ENDPOINT_ENABLED') ===
      'true';

    if (isProduction && !explicitlyEnabled) {
      throw new NotFoundException();
    }

    return {
      module: 'admin',
      sessionContext: 'admin',
      roles: PLATFORM_ADMIN_ROLE_KEYS,
      permissions: PLATFORM_ADMIN_PERMISSIONS,
      statuses: PLATFORM_ADMIN_STATUSES,
      identitySource: 'agency-adapter',
      authRuntimeImplemented: true,
    } as const;
  }
}
