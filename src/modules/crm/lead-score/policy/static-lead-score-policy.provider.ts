import { Injectable } from '@nestjs/common';
import type {
  LeadScorePolicy,
  LeadScorePolicyProvider,
} from '../lead-score.types';
import { LEAD_SCORE_POLICY_V3 } from './lead-score-rules-v3.policy';

/**
 * Serves the policy compiled into the backend.
 *
 * Deliberately behind the provider interface even though there is only one
 * policy: when Analytics eventually publishes candidate policies, replacing
 * this with a `PublishedLeadScorePolicyProvider` must be a wiring change, not
 * an engine change. The engine never reads weights from anywhere else.
 *
 * Scope is declared by the interface and ignored here. V3 reads the Business
 * Mode from the feature set, but still uses one versioned policy for every
 * tenant; the parameter stays in the contract so a published scoped provider
 * can replace this one without rippling through callers.
 */
@Injectable()
export class StaticLeadScorePolicyProvider implements LeadScorePolicyProvider {
  getActivePolicy(): Promise<LeadScorePolicy> {
    return Promise.resolve(LEAD_SCORE_POLICY_V3);
  }
}
