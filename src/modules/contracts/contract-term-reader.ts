import { Repository } from 'typeorm';
import { ContractDefaults, ContractRecord } from './entities';
import { ContractTargetType } from './enums';
import {
  contractToday,
  resolveContractTerm,
  type ContractTerm,
  type ContractTermRecord,
} from './contract-term';
/** One scoped record query for the portfolio, preserving signed AND pending
 * candidates. DISTINCT ON collapses the window aggregate to one row per client. */
export async function readClientContractTerms(
  records: Repository<ContractRecord>,
  defaults: Repository<ContractDefaults>,
  scope: { tenantId: string; workspaceId: string },
  clientIds: string[],
): Promise<Map<string, ContractTerm>> {
  const settings = await defaults.findOne({
    where: {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      targetType: ContractTargetType.Client,
    },
  });
  const windowDays = settings?.expiringWindowDays ?? 30,
    today = contractToday();
  const terms = new Map(
    clientIds.map((id) => [id, resolveContractTerm([], today, windowDays)]),
  );
  if (!clientIds.length) return terms;
  const rows = await records
    .createQueryBuilder('contract')
    .select('contract.target_id', 'targetId')
    .addSelect(
      `jsonb_agg(jsonb_build_object(
      'id',contract.id,'title',contract.title,'status',contract.status,'documentKind',contract.document_kind,
      'signatureProvider',contract.signature_provider,'validFrom',contract.valid_from,'validUntil',contract.valid_until,
      'metadata',contract.metadata,'variablesData',contract.variables_data,'createdAt',contract.created_at,
      'archivedAt',contract.archived_at,'cancelledAt',contract.cancelled_at,
      'signedDocument',EXISTS(SELECT 1 FROM agency_contract_documents d WHERE d.contract_id=contract.id
        AND d.tenant_id=contract.tenant_id AND d.workspace_id=contract.workspace_id AND d.type IN ('signed_pdf','manually_signed_pdf'))
      )) OVER (PARTITION BY contract.target_id)`,
      'records',
    )
    .distinctOn(['contract.target_id'])
    .where('contract.tenant_id = :tenantId', { tenantId: scope.tenantId })
    .andWhere('contract.workspace_id = :workspaceId', {
      workspaceId: scope.workspaceId,
    })
    .andWhere('contract.target_type = :targetType', {
      targetType: ContractTargetType.Client,
    })
    .andWhere('contract.document_kind = :kind', { kind: 'contract' })
    .andWhere('contract.target_id IN (:...clientIds)', { clientIds })
    .orderBy('contract.target_id', 'ASC')
    .getRawMany<{ targetId: string; records: ContractTermRecord[] }>();
  for (const row of rows)
    terms.set(
      row.targetId,
      resolveContractTerm(row.records, today, windowDays),
    );
  return terms;
}
