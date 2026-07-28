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
  AdminIdentityGateway,
  type AdminIdentityRecord,
} from '../contracts/admin-identity.gateway';
import { normalizeAdminEmail } from '../utils/admin-identity.util';

const AGENCY_CONNECTION = 'agency';

@Injectable()
export class AgencyAdminIdentityAdapter extends AdminIdentityGateway {
  constructor(
    @InjectRepository(AgencyUserSecuritySettingsEntity, AGENCY_CONNECTION)
    private readonly securityRepository: Repository<AgencyUserSecuritySettingsEntity>,
    @InjectRepository(AgencyWorkspaceUserEntity, AGENCY_CONNECTION)
    private readonly membershipRepository: Repository<AgencyWorkspaceUserEntity>,
    @InjectRepository(AgencyUserProfileEntity, AGENCY_CONNECTION)
    private readonly profileRepository: Repository<AgencyUserProfileEntity>,
  ) {
    super();
  }

  async findByIdentity(
    tenantId: string,
    userId: string,
  ): Promise<AdminIdentityRecord | null> {
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
        this.findByIdentity(security.tenantId, security.userId),
      ),
    );

    const unique = new Map<string, AdminIdentityRecord>();
    for (const identity of identities) {
      if (identity && identity.email === email) {
        unique.set(`${identity.tenantId}:${identity.userId}`, identity);
      }
    }

    return [...unique.values()];
  }

  async verifyPassword(
    tenantId: string,
    userId: string,
    password: string,
  ): Promise<boolean> {
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
}
