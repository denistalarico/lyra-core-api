import type { AdminTwoFactorMethod } from '../types/admin-access.types';

export type AdminIdentitySource = 'agency' | 'platform_admin';

export type AdminIdentityReference =
  | { source: 'agency'; tenantId: string; userId: string }
  | { source: 'platform_admin'; identityId: string };

export type AdminIdentityRecord = {
  source?: AdminIdentitySource;
  reference?: AdminIdentityReference;
  subjectId?: string;
  /** @deprecated Compatibility fields for Agency-only callers. */
  tenantId?: string | null;
  /** @deprecated Compatibility fields for Agency-only callers. */
  userId?: string | null;
  email: string;
  displayName: string;
  status: 'pending' | 'active' | 'locked' | 'disabled' | 'inactive';
  passwordConfigured: boolean;
  twoFactorEnabled: boolean;
  twoFactorMethod: AdminTwoFactorMethod;
  phone?: string | null;
  jobTitle?: string | null;
  avatarUrl?: string | null;
  lockedUntil?: Date | null;
};

export type AdminIdentitySecurityMaterial = {
  twoFactorSecretEncrypted: string | null;
  twoFactorPendingSecretEncrypted: string | null;
};

export type ResolvedAdminIdentityRecord = AdminIdentityRecord & {
  source: AdminIdentitySource;
  reference: AdminIdentityReference;
  subjectId: string;
};

export function resolveAdminIdentityRecord(
  record: AdminIdentityRecord,
): ResolvedAdminIdentityRecord | null {
  const reference =
    record.reference ??
    (record.tenantId && record.userId
      ? {
          source: 'agency' as const,
          tenantId: record.tenantId,
          userId: record.userId,
        }
      : null);
  if (!reference) return null;
  return {
    ...record,
    source: reference.source,
    reference,
    subjectId:
      record.subjectId ??
      (reference.source === 'agency' ? reference.userId : reference.identityId),
  };
}

export abstract class AdminIdentityGateway {
  abstract findByReference(
    reference: AdminIdentityReference,
  ): Promise<AdminIdentityRecord | null>;

  abstract findCandidatesByEmail(
    normalizedEmail: string,
  ): Promise<AdminIdentityRecord[]>;

  abstract verifyPassword(
    reference: AdminIdentityReference,
    password: string,
  ): Promise<boolean>;

  abstract updateProfile(
    reference: AdminIdentityReference,
    profile: {
      displayName: string;
      phone?: string | null;
      jobTitle?: string | null;
      avatarUrl?: string | null;
    },
  ): Promise<AdminIdentityRecord | null>;

  abstract changePassword(
    reference: AdminIdentityReference,
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean>;

  abstract setPassword(
    reference: AdminIdentityReference,
    newPassword: string,
  ): Promise<boolean>;

  abstract getSecurityMaterial(
    reference: AdminIdentityReference,
  ): Promise<AdminIdentitySecurityMaterial | null>;

  abstract setPendingTwoFactorSecret(
    reference: AdminIdentityReference,
    encryptedSecret: string | null,
  ): Promise<boolean>;

  abstract activateTwoFactor(
    reference: AdminIdentityReference,
    method: AdminTwoFactorMethod,
    encryptedSecret: string | null,
  ): Promise<boolean>;

  abstract clearTwoFactor(reference: AdminIdentityReference): Promise<boolean>;

  abstract registerFailedLogin(
    reference: AdminIdentityReference,
    maxAttempts: number,
    lockTtlMs: number,
  ): Promise<{ locked: boolean }>;

  abstract registerSuccessfulLogin(
    reference: AdminIdentityReference,
  ): Promise<void>;
}
