import { Injectable } from '@nestjs/common';
import {
  AdminIdentityGateway,
  type AdminIdentityReference,
} from '../contracts/admin-identity.gateway';
import { AgencyAdminIdentityAdapter } from './agency-admin-identity.adapter';
import { PlatformAdminIdentityAdapter } from './platform-admin-identity.adapter';

@Injectable()
export class CompositeAdminIdentityGateway extends AdminIdentityGateway {
  constructor(
    private readonly agency: AgencyAdminIdentityAdapter,
    private readonly platformAdmin: PlatformAdminIdentityAdapter,
  ) {
    super();
  }

  findByReference(reference: AdminIdentityReference) {
    return this.adapter(reference).findByReference(reference);
  }

  async findCandidatesByEmail(normalizedEmail: string) {
    const [agency, platformAdmin] = await Promise.all([
      this.agency.findCandidatesByEmail(normalizedEmail),
      this.platformAdmin.findCandidatesByEmail(normalizedEmail),
    ]);
    return [...agency, ...platformAdmin];
  }

  verifyPassword(reference: AdminIdentityReference, password: string) {
    return this.adapter(reference).verifyPassword(reference, password);
  }

  updateProfile(
    reference: AdminIdentityReference,
    profile: Parameters<AdminIdentityGateway['updateProfile']>[1],
  ) {
    return this.adapter(reference).updateProfile(reference, profile);
  }

  changePassword(
    reference: AdminIdentityReference,
    currentPassword: string,
    newPassword: string,
  ) {
    return this.adapter(reference).changePassword(
      reference,
      currentPassword,
      newPassword,
    );
  }

  setPassword(reference: AdminIdentityReference, newPassword: string) {
    return this.adapter(reference).setPassword(reference, newPassword);
  }

  getSecurityMaterial(reference: AdminIdentityReference) {
    return this.adapter(reference).getSecurityMaterial(reference);
  }

  setPendingTwoFactorSecret(
    reference: AdminIdentityReference,
    encryptedSecret: string | null,
  ) {
    return this.adapter(reference).setPendingTwoFactorSecret(
      reference,
      encryptedSecret,
    );
  }

  activateTwoFactor(
    reference: AdminIdentityReference,
    method: 'authenticator' | 'email',
    encryptedSecret: string | null,
  ) {
    return this.adapter(reference).activateTwoFactor(
      reference,
      method,
      encryptedSecret,
    );
  }

  clearTwoFactor(reference: AdminIdentityReference) {
    return this.adapter(reference).clearTwoFactor(reference);
  }

  registerFailedLogin(
    reference: AdminIdentityReference,
    maxAttempts: number,
    lockTtlMs: number,
  ) {
    return this.adapter(reference).registerFailedLogin(
      reference,
      maxAttempts,
      lockTtlMs,
    );
  }

  registerSuccessfulLogin(reference: AdminIdentityReference) {
    return this.adapter(reference).registerSuccessfulLogin(reference);
  }

  private adapter(reference: AdminIdentityReference) {
    return reference.source === 'agency' ? this.agency : this.platformAdmin;
  }
}
