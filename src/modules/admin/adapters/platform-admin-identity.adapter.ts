import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import {
  type AdminIdentityRecord,
  type AdminIdentityReference,
  type AdminIdentitySecurityMaterial,
} from '../contracts/admin-identity.gateway';
import { PlatformAdminIdentityEntity } from '../entities';
import { normalizeAdminEmail } from '../utils/admin-identity.util';

const AGENCY_CONNECTION = 'agency';

@Injectable()
export class PlatformAdminIdentityAdapter {
  constructor(
    @InjectRepository(PlatformAdminIdentityEntity, AGENCY_CONNECTION)
    private readonly repository: Repository<PlatformAdminIdentityEntity>,
  ) {}

  async findByReference(
    reference: AdminIdentityReference,
  ): Promise<AdminIdentityRecord | null> {
    if (reference.source !== 'platform_admin') return null;
    const identity = await this.repository.findOne({
      where: { id: reference.identityId },
    });
    return identity ? this.toRecord(identity) : null;
  }

  async findCandidatesByEmail(emailInput: string) {
    const normalizedEmail = normalizeAdminEmail(emailInput);
    const identities = await this.repository.find({
      where: { normalizedEmail },
    });
    return identities.map((identity) => this.toRecord(identity));
  }

  async verifyPassword(
    reference: AdminIdentityReference,
    password: string,
  ): Promise<boolean> {
    const identity = await this.loadWithSecrets(reference);
    if (
      !identity?.passwordHash ||
      identity.status === 'disabled' ||
      (identity.lockedUntil?.getTime() ?? 0) > Date.now()
    ) {
      return false;
    }
    try {
      return await argon2.verify(identity.passwordHash, password);
    } catch {
      return false;
    }
  }

  async updateProfile(
    reference: AdminIdentityReference,
    profile: { displayName: string },
  ) {
    const identity = await this.load(reference);
    if (!identity) return null;
    identity.displayName = profile.displayName.trim();
    return this.toRecord(await this.repository.save(identity));
  }

  async changePassword(
    reference: AdminIdentityReference,
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    if (!(await this.verifyPassword(reference, currentPassword))) return false;
    return this.setPassword(reference, newPassword);
  }

  async setPassword(
    reference: AdminIdentityReference,
    newPassword: string,
  ): Promise<boolean> {
    const identity = await this.loadWithSecrets(reference);
    if (!identity || identity.status === 'disabled') return false;
    const now = new Date();
    identity.passwordHash = await argon2.hash(newPassword);
    identity.passwordConfiguredAt ??= now;
    identity.lastPasswordChangeAt = now;
    identity.failedLoginAttempts = 0;
    identity.lockedUntil = null;
    if (identity.status === 'locked') identity.status = 'active';
    await this.repository.save(identity);
    return true;
  }

  async getSecurityMaterial(
    reference: AdminIdentityReference,
  ): Promise<AdminIdentitySecurityMaterial | null> {
    const identity = await this.loadWithSecrets(reference);
    return identity
      ? {
          twoFactorSecretEncrypted: identity.twoFactorSecretEncrypted,
          twoFactorPendingSecretEncrypted:
            identity.twoFactorPendingSecretEncrypted,
        }
      : null;
  }

  async setPendingTwoFactorSecret(
    reference: AdminIdentityReference,
    encryptedSecret: string | null,
  ): Promise<boolean> {
    const identity = await this.loadWithSecrets(reference);
    if (!identity) return false;
    identity.twoFactorPendingSecretEncrypted = encryptedSecret;
    await this.repository.save(identity);
    return true;
  }

  async activateTwoFactor(
    reference: AdminIdentityReference,
    method: 'authenticator' | 'email',
    encryptedSecret: string | null,
  ): Promise<boolean> {
    const identity = await this.loadWithSecrets(reference);
    if (!identity) return false;
    identity.twoFactorEnabled = true;
    identity.twoFactorMethod = method;
    identity.twoFactorSecretEncrypted =
      method === 'authenticator' ? encryptedSecret : null;
    identity.twoFactorPendingSecretEncrypted = null;
    await this.repository.save(identity);
    return true;
  }

  async clearTwoFactor(reference: AdminIdentityReference): Promise<boolean> {
    const identity = await this.loadWithSecrets(reference);
    if (!identity) return false;
    identity.twoFactorEnabled = false;
    identity.twoFactorMethod = null;
    identity.twoFactorSecretEncrypted = null;
    identity.twoFactorPendingSecretEncrypted = null;
    await this.repository.save(identity);
    return true;
  }

  async registerFailedLogin(
    reference: AdminIdentityReference,
    maxAttempts: number,
    lockTtlMs: number,
  ): Promise<{ locked: boolean }> {
    const identity = await this.load(reference);
    if (!identity || identity.status === 'disabled') return { locked: false };
    identity.failedLoginAttempts += 1;
    const locked = identity.failedLoginAttempts >= maxAttempts;
    if (locked) {
      identity.status = 'locked';
      identity.lockedUntil = new Date(Date.now() + lockTtlMs);
    }
    await this.repository.save(identity);
    return { locked };
  }

  async registerSuccessfulLogin(
    reference: AdminIdentityReference,
  ): Promise<void> {
    const identity = await this.load(reference);
    if (!identity) return;
    identity.failedLoginAttempts = 0;
    identity.lockedUntil = null;
    if (identity.status === 'locked') identity.status = 'active';
    await this.repository.save(identity);
  }

  private load(reference: AdminIdentityReference) {
    if (reference.source !== 'platform_admin') return Promise.resolve(null);
    return this.repository.findOne({ where: { id: reference.identityId } });
  }

  private loadWithSecrets(reference: AdminIdentityReference) {
    if (reference.source !== 'platform_admin') return Promise.resolve(null);
    return this.repository
      .createQueryBuilder('identity')
      .addSelect([
        'identity.passwordHash',
        'identity.twoFactorSecretEncrypted',
        'identity.twoFactorPendingSecretEncrypted',
      ])
      .where('identity.id = :id', { id: reference.identityId })
      .getOne();
  }

  private toRecord(identity: PlatformAdminIdentityEntity): AdminIdentityRecord {
    const reference = {
      source: 'platform_admin' as const,
      identityId: identity.id,
    };
    return {
      source: 'platform_admin',
      reference,
      subjectId: identity.id,
      email: identity.normalizedEmail,
      displayName: identity.displayName,
      status: identity.status,
      passwordConfigured: Boolean(identity.passwordConfiguredAt),
      twoFactorEnabled: identity.twoFactorEnabled,
      twoFactorMethod:
        identity.twoFactorMethod === 'email' ? 'email' : 'authenticator',
      lockedUntil: identity.lockedUntil,
      phone: null,
      jobTitle: null,
      avatarUrl: null,
    };
  }
}
