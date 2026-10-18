import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgencyClient } from '../../clients/entities/agency-client.entity';
import { AgencyClientCompanyContext } from '../../clients/entities/agency-client-company-context.entity';

/** Same unambiguous, ID-only ownership used by profitability and client billing. */
export async function resolveClientInvoiceOwnership(
  clientsRepo: Repository<AgencyClient>,
  companiesRepo: Repository<AgencyClientCompanyContext>,
  scope: { tenantId: string; workspaceId: string },
) {
  const where = { tenantId: scope.tenantId, workspaceId: scope.workspaceId };
  const [clients, contexts] = await Promise.all([
    clientsRepo.find({ where }),
    companiesRepo.find({ where }),
  ]);
  const clientIds = new Set(clients.map((client) => client.id));
  const candidates = new Map<string, Set<string>>();
  const add = (contactId: string | null, clientId: string) => {
    if (!contactId || !clientIds.has(clientId)) return;
    const owners = candidates.get(contactId) ?? new Set<string>();
    owners.add(clientId);
    candidates.set(contactId, owners);
  };
  for (const client of clients) {
    add(client.contactId, client.id);
    const legacy = client.metadata?.contactId;
    add(
      typeof legacy === 'string' && legacy.trim() ? legacy.trim() : null,
      client.id,
    );
  }
  for (const context of contexts)
    add(context.companyContactId, context.agencyClientId);
  const result = new Map<string, string>();
  for (const [contactId, owners] of candidates)
    if (owners.size === 1 && !clientIds.has(contactId))
      result.set(contactId, [...owners][0]);
  return result;
}
@Injectable()
export class ClientInvoiceOwnershipResolver {
  constructor(
    @InjectRepository(AgencyClient, 'agency')
    private readonly clients: Repository<AgencyClient>,
    @InjectRepository(AgencyClientCompanyContext, 'agency')
    private readonly companies: Repository<AgencyClientCompanyContext>,
  ) {}
  resolve(scope: { tenantId: string; workspaceId: string }) {
    return resolveClientInvoiceOwnership(this.clients, this.companies, scope);
  }
}
