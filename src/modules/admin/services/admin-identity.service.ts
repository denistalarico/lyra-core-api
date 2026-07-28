import { ConflictException, Injectable } from '@nestjs/common';
import {
  AdminIdentityGateway,
  type AdminIdentityRecord,
  type AdminIdentityReference,
} from '../contracts/admin-identity.gateway';
import { normalizeAdminEmail } from '../utils/admin-identity.util';

@Injectable()
export class AdminIdentityService {
  constructor(private readonly identityGateway: AdminIdentityGateway) {}

  findByIdentity(
    reference: AdminIdentityReference,
  ): Promise<AdminIdentityRecord | null> {
    return this.identityGateway.findByReference(reference);
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
    reference: AdminIdentityReference,
    password: string,
  ): Promise<boolean> {
    return this.identityGateway.verifyPassword(reference, password);
  }
}
