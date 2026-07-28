export type AdminIdentityRecord = {
  tenantId: string;
  userId: string;
  email: string;
  displayName: string;
  status: 'active' | 'inactive';
  passwordConfigured: boolean;
  twoFactorEnabled: boolean;
  twoFactorMethod: 'authenticator' | 'email';
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
}
