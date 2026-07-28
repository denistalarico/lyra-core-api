import { SetMetadata } from '@nestjs/common';
import type { PlatformAdminPermission } from '../types/admin-access.types';

export const ADMIN_PERMISSIONS_METADATA = 'admin:required-permissions';

export const RequireAdminPermissions = (
  ...permissions: readonly PlatformAdminPermission[]
) => SetMetadata(ADMIN_PERMISSIONS_METADATA, permissions);
