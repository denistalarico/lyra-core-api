import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Raw, Repository } from 'typeorm';
import { AgencyUserSecuritySettingsEntity } from '../../agency/entities/agency-auth.entities';
import {
  AgencyUserProfileEntity,
  AgencyWorkspaceUserEntity,
} from '../../agency/entities/agency-settings.entities';
import {
  type AdminIdentityReference,
  type AdminIdentityRecord,
  type AdminIdentitySecurityMaterial,
} from '../contracts/admin-identity.gateway';
import { normalizeAdminEmail } from '../utils/admin-identity.util';

const AGENCY_CONNECTION = 'agency';

@Injectable()
export class AgencyAdminIdentityAdapter {
  constructor(
    @InjectRepository(AgencyUserSecuritySettingsEntity, AGENCY_CONNECTION)
    private readonly securityRepository: Repository<AgencyUserSecuritySettingsEntity>,
    @InjectRepository(AgencyWorkspaceUserEntity, AGENCY_CONNECTION)
    private readonly membershipRepository: Repository<AgencyWorkspaceUserEntity>,
    @InjectRepository(AgencyUserProfileEntity, AGENCY_CONNECTION)
    private readonly profileRepository: Repository<AgencyUserProfileEntity>,
  ) {}

  async findByReference(
    reference: AdminIdentityReference,
  ): Promise<AdminIdentityRecord | null> {
    if (reference.source !== 'agency') return null;
    const { tenantId, userId } = reference;
    const security = await this.securityRepository.findOne({
      where: { tenantId, userId },
    });

    if (!security) {
      return null;
    }

    const [membership, profile] = await Promise.all([
      this.membershipRepository.findOne({
        where: { tenantId, userId, status: 'active' },
        order: { updatedAt: 'DESC' },
      }),
      this.profileRepository.findOne({ where: { tenantId, userId } }),
    ]);

    if (!membership) {
      return null;
    }

    const email = normalizeAdminEmail(
      security.currentEmail || profile?.email || membership.email,
    );

    if (!email) {
      return null;
    }

    return {
      source: 'agency',
      reference,
      subjectId: userId,
      tenantId,
      userId,
      email,
      displayName:
        profile?.displayName.trim() || membership.name.trim() || email,
      status: 'active',
      passwordConfigured: Boolean(security.passwordHash),
      twoFactorEnabled:
        security.twoFactorEnabled || Boolean(security.twoFactorSecretEncrypted),
      twoFactorMethod:
        security.twoFactorMethod === 'email' ? 'email' : 'authenticator',
      phone: profile?.phone ?? null,
      jobTitle: profile?.jobTitle ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
    };
  }

  async findCandidatesByEmail(
    normalizedEmail: string,
  ): Promise<AdminIdentityRecord[]> {
    const email = normalizeAdminEmail(normalizedEmail);
    if (!email) {
      return [];
    }

    const securityRecords = await this.securityRepository.find({
      where: {
        currentEmail: Raw(
          (column) => `LOWER(TRIM(${column})) = :normalizedEmail`,
          { normalizedEmail: email },
        ),
      },
      order: { updatedAt: 'DESC' },
    });

    const identities = await Promise.all(
      securityRecords.map((security) =>
        this.findByReference({
          source: 'agency',
          tenantId: security.tenantId,
          userId: security.userId,
        }),
      ),
    );

    const unique = new Map<string, AdminIdentityRecord>();
    for (const identity of identities) {
      if (identity && identity.email === email) {
        const reference = identity.reference!;
        if (reference.source === 'agency') {
          unique.set(`${reference.tenantId}:${reference.userId}`, identity);
        }
      }
    }

    return [...unique.values()];
  }

  verifyPassword(
    reference: AdminIdentityReference,
    password: string,
  ): Promise<boolean>;
  verifyPassword(
    tenantId: string,
    userId: string,
    password: string,
  ): Promise<boolean>;
  async verifyPassword(
    referenceOrTenant: AdminIdentityReference | string,
    passwordOrUser: string,
    legacyPassword?: string,
  ): Promise<boolean> {
    const reference =
      typeof referenceOrTenant === 'string'
        ? {
            source: 'agency' as const,
            tenantId: referenceOrTenant,
            userId: passwordOrUser,
          }
        : referenceOrTenant;
    const password =
      typeof referenceOrTenant === 'string'
        ? (legacyPassword ?? '')
        : passwordOrUser;
    if (reference.source !== 'agency') return false;
    const { tenantId, userId } = reference;
    const [security, activeMembership] = await Promise.all([
      this.securityRepository.findOne({ where: { tenantId, userId } }),
      this.membershipRepository.findOne({
        where: { tenantId, userId, status: 'active' },
      }),
    ]);

    if (!security?.passwordHash || !activeMembership) {
      return false;
    }

    try {
      return await argon2.verify(security.passwordHash, password);
    } catch {
      return false;
    }
  }

  updateProfile(
    reference: AdminIdentityReference,
    input: {
      displayName: string;
      phone?: string | null;
      jobTitle?: string | null;
      avatarUrl?: string | null;
    },
  ): Promise<AdminIdentityRecord | null>;
  updateProfile(
    tenantId: string,
    userId: string,
    input: {
      displayName: string;
      phone?: string | null;
      jobTitle?: string | null;
      avatarUrl?: string | null;
    },
  ): Promise<AdminIdentityRecord | null>;
  async updateProfile(
    referenceOrTenant: AdminIdentityReference | string,
    inputOrUser:
      | {
          displayName: string;
          phone?: string | null;
          jobTitle?: string | null;
          avatarUrl?: string | null;
        }
      | string,
    legacyInput?: {
      displayName: string;
      phone?: string | null;
      jobTitle?: string | null;
      avatarUrl?: string | null;
    },
  ): Promise<AdminIdentityRecord | null> {
    const reference =
      typeof referenceOrTenant === 'string'
        ? {
            source: 'agency' as const,
            tenantId: referenceOrTenant,
            userId: inputOrUser as string,
          }
        : referenceOrTenant;
    const input =
      typeof referenceOrTenant === 'string'
        ? legacyInput!
        : (inputOrUser as {
            displayName: string;
            phone?: string | null;
            jobTitle?: string | null;
            avatarUrl?: string | null;
          });
    if (reference.source !== 'agency') return null;
    const { tenantId, userId } = reference;
    const [profile, activeMembership] = await Promise.all([
      this.profileRepository.findOne({ where: { tenantId, userId } }),
      this.membershipRepository.findOne({
        where: { tenantId, userId, status: 'active' },
      }),
    ]);
    if (!profile || !activeMembership) {
      return null;
    }

    profile.displayName = input.displayName.trim();
    if (input.phone !== undefined) profile.phone = input.phone;
    if (input.jobTitle !== undefined) profile.jobTitle = input.jobTitle;
    if (input.avatarUrl !== undefined) profile.avatarUrl = input.avatarUrl;
    await this.profileRepository.save(profile);

    return this.findByReference(reference);
  }

  async changePassword(
    reference: AdminIdentityReference,
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    if (reference.source !== 'agency') return false;
    const { tenantId, userId } = reference;
    const security = await this.securityRepository.findOne({
      where: { tenantId, userId },
    });
    if (!security?.passwordHash) {
      return false;
    }

    try {
      if (!(await argon2.verify(security.passwordHash, currentPassword))) {
        return false;
      }
    } catch {
      return false;
    }

    security.passwordHash = await argon2.hash(newPassword);
    security.passwordUpdatedAt = new Date();
    await this.securityRepository.save(security);
    return true;
  }

  setPassword(): Promise<boolean> {
    // Agency recovery remains owned by the existing Agency flow.
    return Promise.resolve(false);
  }

  async getSecurityMaterial(
    reference: AdminIdentityReference,
  ): Promise<AdminIdentitySecurityMaterial | null> {
    if (reference.source !== 'agency') return null;
    const security = await this.securityRepository.findOne({
      where: { tenantId: reference.tenantId, userId: reference.userId },
    });
    return security
      ? {
          twoFactorSecretEncrypted: security.twoFactorSecretEncrypted,
          twoFactorPendingSecretEncrypted:
            security.twoFactorPendingSecretEncrypted,
        }
      : null;
  }

  async setPendingTwoFactorSecret(
    reference: AdminIdentityReference,
    encryptedSecret: string | null,
  ): Promise<boolean> {
    if (reference.source !== 'agency') return false;
    const security = await this.securityRepository.findOne({
      where: { tenantId: reference.tenantId, userId: reference.userId },
    });
    if (!security) return false;
    security.twoFactorPendingSecretEncrypted = encryptedSecret;
    await this.securityRepository.save(security);
    return true;
  }

  async activateTwoFactor(
    reference: AdminIdentityReference,
    method: 'authenticator' | 'email',
    encryptedSecret: string | null,
  ): Promise<boolean> {
    if (reference.source !== 'agency') return false;
    const security = await this.securityRepository.findOne({
      where: { tenantId: reference.tenantId, userId: reference.userId },
    });
    if (!security) return false;
    security.twoFactorEnabled = true;
    security.twoFactorMethod = method;
    security.twoFactorSecretEncrypted =
      method === 'authenticator' ? encryptedSecret : null;
    security.twoFactorPendingSecretEncrypted = null;
    await this.securityRepository.save(security);
    return true;
  }

  async clearTwoFactor(reference: AdminIdentityReference): Promise<boolean> {
    if (reference.source !== 'agency') return false;
    const security = await this.securityRepository.findOne({
      where: { tenantId: reference.tenantId, userId: reference.userId },
    });
    if (!security) return false;
    security.twoFactorEnabled = false;
    security.twoFactorMethod = 'authenticator';
    security.twoFactorSecretEncrypted = null;
    security.twoFactorPendingSecretEncrypted = null;
    await this.securityRepository.save(security);
    return true;
  }

  registerFailedLogin(): Promise<{ locked: boolean }> {
    return Promise.resolve({ locked: false });
  }

  async registerSuccessfulLogin(): Promise<void> {
    // Agency login policy is intentionally unchanged.
  }

  /** @deprecated Agency-only compatibility surface. */
  async findByIdentity(tenantId: string, userId: string) {
    const identity = await this.findByReference({
      source: 'agency',
      tenantId,
      userId,
    });
    if (!identity) return null;
    return {
      tenantId: identity.tenantId,
      userId: identity.userId,
      email: identity.email,
      displayName: identity.displayName,
      status: identity.status,
      passwordConfigured: identity.passwordConfigured,
      twoFactorEnabled: identity.twoFactorEnabled,
      twoFactorMethod: identity.twoFactorMethod,
      phone: identity.phone,
      jobTitle: identity.jobTitle,
      avatarUrl: identity.avatarUrl,
    };
  }

  /** @deprecated Agency-only compatibility surface. */
  updatePassword(
    tenantId: string,
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    return this.changePassword(
      { source: 'agency', tenantId, userId },
      currentPassword,
      newPassword,
    );
  }
}
