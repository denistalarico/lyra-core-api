import type { AdminIdentityReference } from '../contracts/admin-identity.gateway';
import type { PlatformInternalAdminEntity } from '../entities';
import type { AdminPrincipal } from '../types/admin-access.types';

export function normalizeAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function adminIdentityReference(
  admin: Pick<
    PlatformInternalAdminEntity,
    'identitySource' | 'identityTenantId' | 'userId' | 'platformAdminIdentityId'
  >,
): AdminIdentityReference | null {
  if (
    (admin.identitySource === 'agency' || !admin.identitySource) &&
    admin.identityTenantId &&
    admin.userId
  ) {
    return {
      source: 'agency',
      tenantId: admin.identityTenantId,
      userId: admin.userId,
    };
  }
  if (
    admin.identitySource === 'platform_admin' &&
    admin.platformAdminIdentityId
  ) {
    return {
      source: 'platform_admin',
      identityId: admin.platformAdminIdentityId,
    };
  }
  return null;
}

export function principalIdentityReference(
  principal: Pick<
    AdminPrincipal,
    'identitySource' | 'identityTenantId' | 'userId' | 'platformAdminIdentityId'
  >,
): AdminIdentityReference {
  const reference = adminIdentityReference(principal);
  if (!reference) throw new Error('Invalid administrative identity reference.');
  return reference;
}

export function identityColumns(reference: AdminIdentityReference) {
  return reference.source === 'agency'
    ? {
        identitySource: 'agency' as const,
        identityTenantId: reference.tenantId,
        userId: reference.userId,
        platformAdminIdentityId: null,
      }
    : {
        identitySource: 'platform_admin' as const,
        identityTenantId: null,
        userId: null,
        platformAdminIdentityId: reference.identityId,
      };
}
