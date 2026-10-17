import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { CompanyAwareScope } from '../context/company-aware-scope';
import type { CompanyProductKey } from '../../modules/clients/entities/agency-client-company-product.entity';

export type PendingCompanyWork = {
  id: string;
  kind: 'publication' | 'approval' | 'automation' | 'agent' | 'appointment';
  title: string;
  status: string;
  scheduledAt?: string | null;
};
export type CompanyProductOperation = {
  manager: EntityManager;
  scope: CompanyAwareScope & {
    agencyClientId: string;
    companyContextId: string;
  };
  actorUserId: string | null;
  afterCommit: Array<() => Promise<unknown>>;
};
export interface CompanyProductParticipant {
  key: string;
  productKey: CompanyProductKey;
  pending(op: CompanyProductOperation): Promise<PendingCompanyWork[]>;
  capacity?(op: CompanyProductOperation): Promise<{
    activeCompanies: number;
    limit: number | null;
    availableSlots: number | null;
  }>;
  activate?(op: CompanyProductOperation): Promise<string | null>;
  remove?(op: CompanyProductOperation): Promise<void>;
  retry?(op: CompanyProductOperation, ids: string[]): Promise<string[]>;
}

/** CA6/D-09: domains register themselves; no third-party token binding. */
@Injectable()
export class CompanyProductRegistry {
  private readonly entries = new Map<string, CompanyProductParticipant>();
  register(entry: CompanyProductParticipant): void {
    if (this.entries.has(entry.key))
      throw new Error(`Duplicate company product participant: ${entry.key}`);
    this.entries.set(entry.key, entry);
  }
  forProduct(productKey: CompanyProductKey): CompanyProductParticipant[] {
    const required =
      productKey === 'social'
        ? ['social-publications', 'social-approvals']
        : [
            'leadflow-settings',
            'leadflow-agents',
            'leadflow-automations',
            'leadflow-agenda',
          ];
    for (const key of required)
      if (!this.entries.has(key))
        throw new ServiceUnavailableException(
          `Company product participant unavailable: ${key}`,
        );
    return [...this.entries.values()].filter(
      (p) => p.productKey === productKey,
    );
  }
}
