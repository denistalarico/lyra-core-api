import type { DataSource } from 'typeorm';
import { AGENCY_SALES_QUALIFIED_STAGE_TYPES } from '../agency/entities/agency-sales.entities';

/**
 * AN-CRM / GA-CONV (owner decision, 2026-11-20): "qualified" is a class of the
 * stage, set on each CRM's stage screen — never a position nor a name, which
 * the agency customizes.
 *
 * - LeadFlow CRM: `crm_stages.role = 'qualified'` (any number per pipeline).
 * - Agency CRM: `agency_sales_stages.type` in `qualified`/`proposal`/
 *   `negotiation` (`AGENCY_SALES_QUALIFIED_STAGE_TYPES`).
 *
 * A deal is qualified when it is won, is in such a stage now, or passed
 * through one (each CRM's stage history: `after_data.stageId`). The Agency
 * history exists only from AG-EVT onward, so older deals count by their
 * current stage. The stage's class is read today: reclassifying a stage
 * re-reads the past, which is what "the class decides" means.
 *
 * Every literal below comes from constants, never from input.
 */

export type CrmQualifiedScope = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId: string | null;
};

export type QualifiedStageGroup = {
  crm: 'agency_sales' | 'leadflow_crm';
  pipelineId: string;
  pipelineName: string;
  stages: Array<{ id: string; name: string; position: number }>;
};

export const LEADFLOW_QUALIFIED_ROLE = 'qualified';

const AGENCY_QUALIFIED_LIST = AGENCY_SALES_QUALIFIED_STAGE_TYPES.map(
  (type) => `'${type}'`,
).join(', ');

/**
 * LeadFlow CRM scope, the same rule as the Forms ingestion: a client deal
 * carries both client and company context; anything else is the agency's own.
 */
export function leadflowScopeOf(scope: CrmQualifiedScope) {
  const client = Boolean(scope.agencyClientId && scope.companyContextId);
  return {
    agencyClientId: client ? scope.agencyClientId : null,
    companyContextId: client ? scope.companyContextId : null,
  };
}

/** Agency CRM. `o` = `agency_sales_opportunities`, `s` = its stage (LEFT JOIN). */
export const AGENCY_REACHED_QUALIFIED_SQL = `(
  COALESCE(s."type" IN (${AGENCY_QUALIFIED_LIST}), false)
  OR EXISTS (
    SELECT 1
      FROM "agency_sales_opportunity_events" e
      JOIN "agency_sales_stages" qs
        ON qs."id"::text = e."after_data"->>'stageId'
       AND qs."tenant_id" = e."tenant_id" AND qs."workspace_id" = e."workspace_id"
     WHERE e."tenant_id" = o."tenant_id" AND e."workspace_id" = o."workspace_id"
       AND e."opportunity_id" = o."id"
       AND qs."type" IN (${AGENCY_QUALIFIED_LIST})
  ))`;

/** LeadFlow CRM. `o` = `crm_opportunities`, `s` = its stage (LEFT JOIN). */
export const LEADFLOW_REACHED_QUALIFIED_SQL = `(
  COALESCE(s."role" = '${LEADFLOW_QUALIFIED_ROLE}', false)
  OR EXISTS (
    SELECT 1
      FROM "crm_opportunity_events" e
      JOIN "crm_stages" qs
        ON qs."id"::text = e."after_data"->>'stageId'
       AND qs."tenant_id" = e."tenant_id" AND qs."workspace_id" = e."workspace_id"
     WHERE e."tenant_id" = o."tenant_id" AND e."workspace_id" = o."workspace_id"
       AND e."opportunity_id" = o."id"
       AND qs."role" = '${LEADFLOW_QUALIFIED_ROLE}'
  ))`;

type StageRow = {
  pipelineId: string;
  pipelineName: string;
  id: string;
  name: string;
  position: number | string;
};

/**
 * The stages classified as qualified in the scope, grouped by funnel. Empty =
 * nothing is classified yet ("configure a etapa"). The Agency CRM is the
 * agency's own; client contexts use the LeadFlow CRM.
 */
export async function listQualifiedStages(
  dataSource: DataSource,
  scope: CrmQualifiedScope,
): Promise<QualifiedStageGroup[]> {
  const groups: QualifiedStageGroup[] = [];
  if (!scope.agencyClientId) {
    const rows = await dataSource.query<StageRow[]>(
      `SELECT p."id" AS "pipelineId", p."name" AS "pipelineName", s."id", s."name", s."position"
         FROM "agency_sales_pipelines" p
         JOIN "agency_sales_stages" s ON s."pipeline_id" = p."id"
        WHERE p."tenant_id" = $1 AND p."workspace_id" = $2 AND p."status" = 'active'
          AND s."tenant_id" = $1 AND s."workspace_id" = $2
          AND s."type" IN (${AGENCY_QUALIFIED_LIST})
        ORDER BY p."position", p."name", s."position"`,
      [scope.tenantId, scope.workspaceId],
    );
    groups.push(...group('agency_sales', rows));
  }
  const lf = leadflowScopeOf(scope);
  const rows = await dataSource.query<StageRow[]>(
    `SELECT p."id" AS "pipelineId", p."name" AS "pipelineName", s."id", s."name", s."sort_order" AS "position"
       FROM "crm_pipelines" p
       JOIN "crm_stages" s ON s."pipeline_id" = p."id"
      WHERE p."tenant_id" = $1 AND p."workspace_id" = $2
        AND p."agency_client_id" IS NOT DISTINCT FROM $3::uuid
        AND p."company_context_id" IS NOT DISTINCT FROM $4::uuid
        AND p."deleted_at" IS NULL AND s."deleted_at" IS NULL
        AND s."role" = '${LEADFLOW_QUALIFIED_ROLE}'
      ORDER BY p."sort_order", p."name", s."sort_order"`,
    [scope.tenantId, scope.workspaceId, lf.agencyClientId, lf.companyContextId],
  );
  groups.push(...group('leadflow_crm', rows));
  return groups;
}

function group(
  crm: QualifiedStageGroup['crm'],
  rows: StageRow[],
): QualifiedStageGroup[] {
  const groups = new Map<string, QualifiedStageGroup>();
  for (const row of rows) {
    let entry = groups.get(row.pipelineId);
    if (!entry) {
      entry = {
        crm,
        pipelineId: row.pipelineId,
        pipelineName: row.pipelineName,
        stages: [],
      };
      groups.set(row.pipelineId, entry);
    }
    entry.stages.push({
      id: row.id,
      name: row.name,
      position: Number(row.position),
    });
  }
  return [...groups.values()];
}
