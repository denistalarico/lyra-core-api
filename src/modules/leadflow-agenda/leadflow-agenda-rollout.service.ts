import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../../common/context/request-context.interface';

/**
 * Allows the canonical Agenda to be enabled incrementally without granting a
 * context access it did not already have. Values are comma-separated
 * `tenantId:workspaceId` pairs; `*` enables every already-authorized context.
 */
@Injectable()
export class LeadFlowAgendaRolloutService {
  isCanonicalAgendaEnabled(context: RequestContext): boolean {
    const configuredTargets =
      process.env.LEADFLOW_CANONICAL_AGENDA_ROLLOUT?.split(',')
        .map((target) => target.trim())
        .filter(Boolean) ?? [];

    if (configuredTargets.includes('*')) {
      return true;
    }

    const workspaceId = context.workspaceId;
    if (!workspaceId) {
      return false;
    }

    return configuredTargets.includes(`${context.tenantId}:${workspaceId}`);
  }
}
