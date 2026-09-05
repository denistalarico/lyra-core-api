import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import {
  UNCONFIGURED_BUSINESS_MODE,
  type BusinessModeDimension,
  type IntelligenceScope,
} from '../../../common/intelligence';
import type { BusinessModeDimensionPort } from './business-mode-dimension.port';

/**
 * LeadFlow's answer to "what business mode is this context".
 *
 * A fourth adapter beside the fact source and the two attribution ports, split
 * from all three for the reason each split was made: it answers about the
 * *context* rather than about facts, conversations or a cohort, and it has no
 * window at any point in its shape.
 *
 * ## Why SQL and not `LeadFlowClientSettingsService`
 *
 * Reusing that service would mean reusing three things this read must not have.
 * It takes a `RequestContext` — which `IntelligenceScope` deliberately is not,
 * because a fact source must remain callable from a scheduled job or a Client
 * Area render with no HTTP request behind it. It throws `NotFoundException` for
 * a missing row — which is the *normal* Social-only answer here, not an error.
 * And it maps a full settings response with the company-context document, the
 * playbook and every override, to read one column.
 *
 * The trade is that the storage shape is now named in two places. That is
 * acceptable because this is a strictly read-only projection of two columns,
 * and the alternative — a second public method on the settings service shaped
 * for a caller in another module — would put the same knowledge in two places
 * with an extra indirection over it.
 */
@Injectable()
export class BusinessModeDimensionAdapter implements BusinessModeDimensionPort {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  /**
   * One query, two facts: the stored key and whether the catalog knows it.
   *
   * ## Why the catalog lookup is a `LEFT JOIN LATERAL` and not a second call
   *
   * §28 asks that the lookup be cheap and that no query repeat inside a loop.
   * The natural implementation — read the settings row, then ask the template
   * service for the key's label — is two round trips for one label on a path
   * that already runs beside a cohort query. Folding it into one statement also
   * makes the `unknown_key` case fall out of the data rather than out of a
   * caught exception: the join simply misses, and `label` comes back null.
   *
   * The lateral resolves the same precedence `LeadFlowBusinessModeTemplate
   * Service.getTemplateByKey` applies — a tenant's own template wins over the
   * official one, highest version first — because a label that disagreed with
   * the one the settings screen shows would be worse than no label at all.
   */
  async businessMode(scope: IntelligenceScope): Promise<BusinessModeDimension> {
    const rows = await this.dataSource.query<BusinessModeRow[]>(
      `
        /* intelligence-business-mode:current */
        SELECT settings.business_mode_key AS "key",
               catalog.name               AS "label"
        FROM leadflow_client_settings settings
        LEFT JOIN LATERAL (
          SELECT template.name
          FROM leadflow_business_mode_templates template
          WHERE template.key = settings.business_mode_key
            AND template.status = 'active'
            AND template.deleted_at IS NULL
            AND (template.tenant_id = $1 OR template.tenant_id IS NULL)
          -- IS NOT DISTINCT FROM rather than plain equality. The official rows
          -- have a NULL tenant_id, so an equality test evaluates to NULL for
          -- them — and NULL sorts FIRST under DESC, which handed the official
          -- template priority over the tenant's own. The three-valued
          -- comparison returns a real boolean, so true (the custom row) leads.
          ORDER BY (template.tenant_id IS NOT DISTINCT FROM $1) DESC,
                   template.version DESC
          LIMIT 1
        ) catalog ON TRUE
        -- No settings.deleted_at predicate here, and its absence is deliberate
        -- rather than an oversight: leadflow_client_settings has no soft-delete
        -- column at all, unlike the templates table joined above. Adding the
        -- predicate defensively would not be harmless — it would fail the query
        -- outright, which is how the gated suite caught it.
        WHERE settings.tenant_id = $1
          AND settings.workspace_id = $2
          -- The null in the scope means "the agency's own context". Written as
          -- an explicit IS NULL rather than an equality against a null
          -- parameter, which matches nothing and would silently report every
          -- agency context as unconfigured.
          AND settings.agency_client_id IS NOT DISTINCT FROM $3::uuid
        LIMIT 1
      `,
      [scope.tenantId, scope.workspaceId, scope.agencyClientId],
    );

    const row = rows[0];

    /**
     * No settings row, or a row with the column blank.
     *
     * Both resolve to the same shared constant, and that is the point: a
     * Social-only tenant that has never had a LeadFlow row and a LeadFlow
     * context whose mode was cleared are the same answer — "nothing is
     * configured" — and a reader must not be able to tell them apart by shape.
     */
    if (!row?.key) {
      return UNCONFIGURED_BUSINESS_MODE;
    }

    /**
     * A key nobody in the catalog claims.
     *
     * Reported verbatim rather than nulled. This is reachable in production
     * without anything malicious: a tenant-custom template can be soft-deleted
     * or deactivated while a settings row still points at its key. Turning that
     * into `unconfigured` would erase the only evidence of the inconsistency
     * and make a broken context indistinguishable from an empty one — while
     * still leaving the bad key in the database to segment on later.
     */
    if (!row.label) {
      return {
        key: row.key,
        label: null,
        resolution: 'unknown_key',
        source: 'leadflow_client_settings',
        temporalSemantics: 'current_context_dimension',
      };
    }

    return {
      key: row.key,
      label: row.label,
      resolution: 'configured',
      source: 'leadflow_client_settings',
      temporalSemantics: 'current_context_dimension',
    };
  }
}

type BusinessModeRow = { key: string | null; label: string | null };
