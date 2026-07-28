export type AdminIdentityRecord = {
  tenantId: string;
  userId: string;
  email: string;
  displayName: string;
  status: 'active' | 'inactive';
  passwordConfigured: boolean;
  twoFactorEnabled: boolean;
  twoFactorMethod: 'authenticator' | 'email';
  phone?: string | null;
  jobTitle?: string | null;
  avatarUrl?: string | null;
};

export abstract class AdminIdentityGateway {
  abstract findByIdentity(
    tenantId: string,
    userId: string,
  ): Promise<AdminIdentityRecord | null>;

  abstract findCandidatesByEmail(
    normalizedEmail: string,
  ): Promise<AdminIdentityRecord[]>;

  abstract verifyPassword(
    tenantId: string,
    userId: string,
    password: string,
  ): Promise<boolean>;

  abstract updateProfile(
    tenantId: string,
    userId: string,
    profile: {
      displayName: string;
      phone?: string | null;
      jobTitle?: string | null;
      avatarUrl?: string | null;
    },
  ): Promise<AdminIdentityRecord | null>;

  abstract updatePassword(
    tenantId: string,
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean>;
}
