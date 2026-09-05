import type { BenchmarkBusinessModeVocabulary } from '../../../common/intelligence';
import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';

/**
 * The system-defined business modes, and the only ones a cross-tenant cohort
 * may use.
 *
 * Lives here rather than in `common/intelligence` because the contract folder
 * may not enumerate business modes — `leadflow_business_mode_templates` is
 * tenant-extensible, so a list written into a shared contract would be wrong for
 * any tenant that added a template. LeadFlow owns the catalog, so LeadFlow
 * supplies the vocabulary, and the contract decides what to do with it.
 *
 * ## Why the enum and not the table
 *
 * This is the one place where reading the *enum* rather than querying the
 * *table* is correct, and the distinction is the whole eligibility rule.
 * `LeadFlowBusinessMode` is exactly the set of modes Lyra defines and whose
 * meaning is therefore identical across every tenant. The table is a superset:
 * it also holds tenant-custom templates, and those are precisely what must be
 * excluded. Querying the table for eligibility would admit a tenant's custom
 * mode into a cross-tenant cohort — the §4 failure, and an invisible one,
 * because the resulting number looks like a benchmark.
 *
 * Two tenants that both created a mode named "clínicas" have not agreed on what
 * it means. There is no mapping from custom to official here, by label or
 * otherwise, and there is deliberately nothing in this file that could grow one.
 */
export const BENCHMARK_SYSTEM_BUSINESS_MODES: BenchmarkBusinessModeVocabulary =
  new Set<string>(Object.values(LeadFlowBusinessMode));
