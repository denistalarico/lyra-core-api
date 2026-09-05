import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import {
  BENCHMARK_ELIGIBLE_DESTINATIONS,
  BENCHMARK_WINDOW_KEYS,
} from '../../../common/intelligence';
import { BENCHMARK_SYSTEM_BUSINESS_MODES } from '../../leadflow-analytics/intelligence/benchmark-business-mode-vocabulary';

/**
 * The complete set of questions a caller may ask a benchmark.
 *
 * Every field is `@IsIn` a closed list, and that is the point rather than a
 * style preference: this DTO *is* the differencing control. §17 and §25 forbid
 * arbitrary dimensions, tenant filters, exclusion lists and free date ranges —
 * none of which appear here, so none can be expressed. What a caller can vary is
 * four enumerated axes, and the set of distinct questions is therefore finite,
 * fixed at deploy time, and small enough to enumerate in a test.
 *
 * There is deliberately no `tenantId`, no `excludeTenantId`, no `since`/`until`,
 * no `groupBy` and no `dimensions[]`. Adding any of them would reopen the attack
 * the closed vocabulary closes: repeated narrow queries whose differences
 * isolate a single contributor.
 */
export class BenchmarkQueryDto {
  /**
   * The cohort's business mode.
   *
   * Restricted to the system catalog at the validation layer as well as in the
   * service, because a tenant-custom key must be refused as *malformed input*
   * rather than reaching a query that would then find nothing. The two failures
   * look identical to a caller; only the first says why.
   */
  @IsIn([...BENCHMARK_SYSTEM_BUSINESS_MODES])
  businessModeKey!: string;

  @IsIn(['meta'])
  provider!: string;

  @IsIn([...BENCHMARK_ELIGIBLE_DESTINATIONS])
  destination!: string;

  /**
   * Required for monetary metrics, rejected as meaningless for counts.
   *
   * Validated here only for shape; whether it is *required* depends on the
   * metric, which the service decides — a DTO cannot see the path parameter.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency must be an ISO 4217 alphabetic code, e.g. BRL.',
  })
  currency?: string;

  /**
   * The window. One member today, and still an enum rather than an implicit
   * default so a second window can never silently change what an existing
   * caller receives.
   */
  @IsOptional()
  @IsIn([...BENCHMARK_WINDOW_KEYS])
  window?: string;
}
