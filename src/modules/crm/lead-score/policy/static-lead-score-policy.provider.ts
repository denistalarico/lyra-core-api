import { Injectable } from '@nestjs/common';
import type {
  LeadScorePolicy,
  LeadScorePolicyProvider,
} from '../lead-score.types';
import { LEAD_SCORE_POLICY_V1 } from './lead-score-rules-v1.policy';

/**
 * Serves the policy compiled into the backend.
 *
 * Deliberately behind the provider interface even though there is only one
 * policy: when Analytics eventually publishes candidate policies, replacing
 * this with a `PublishedLeadScorePolicyProvider` must be a wiring change, not
 * an engine change. The engine never reads weights from anywhere else.
 *
 * Scope is declared by the interface and ignored here. V1 has no per-tenant or
 * per-Business-Mode policy; the parameter stays in the contract so adding one
 * later does not ripple through every caller.
 */
@Injectable()
export class StaticLeadScorePolicyProvider implements LeadScorePolicyProvider {
  getActivePolicy(): Promise<LeadScorePolicy> {
    return Promise.resolve(LEAD_SCORE_POLICY_V1);
  }
}
