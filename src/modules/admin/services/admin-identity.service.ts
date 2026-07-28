import { ConflictException, Injectable } from '@nestjs/common';
import {
  AdminIdentityGateway,
  type AdminIdentityRecord,
} from '../contracts/admin-identity.gateway';
import { normalizeAdminEmail } from '../utils/admin-identity.util';

@Injectable()
export class AdminIdentityService {
  constructor(private readonly identityGateway: AdminIdentityGateway) {}

  findByIdentity(
    tenantId: string,
    userId: string,
  ): Promise<AdminIdentityRecord | null> {
    return this.identityGateway.findByIdentity(tenantId, userId);
  }

  findCandidatesByEmail(email: string): Promise<AdminIdentityRecord[]> {
    return this.identityGateway.findCandidatesByEmail(
      normalizeAdminEmail(email),
    );
  }

  async resolveUniqueCandidateByEmail(
    email: string,
  ): Promise<AdminIdentityRecord | null> {
    const candidates = await this.findCandidatesByEmail(email);
    if (candidates.length > 1) {
      throw new ConflictException(
        'Administrative identity is ambiguous; tenant and user selection is required.',
      );
    }

    return candidates[0] ?? null;
  }

  verifyPassword(
    tenantId: string,
    userId: string,
    password: string,
  ): Promise<boolean> {
    return this.identityGateway.verifyPassword(tenantId, userId, password);
  }
}
