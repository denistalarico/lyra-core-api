import {
  LeadFlowBriefingContextSnapshotEntity,
  LeadFlowBriefingExtractionJobEntity,
  LeadFlowBriefingSourceEntity,
  LeadFlowBriefingSourceVersionEntity,
  LeadFlowBriefingSuggestionApplicationEntity,
  LeadFlowBriefingSuggestionEntity,
} from '../modules/leadflow-briefing/entities';
import { agencyEntities, getAgencyTypeOrmConfig } from './typeorm.config';

describe('Agency TypeORM configuration', () => {
  it('registers every LeadFlow Briefing entity in the runtime data source', () => {
    const briefingEntities = [
      LeadFlowBriefingSourceEntity,
      LeadFlowBriefingSourceVersionEntity,
      LeadFlowBriefingExtractionJobEntity,
      LeadFlowBriefingSuggestionEntity,
      LeadFlowBriefingContextSnapshotEntity,
      LeadFlowBriefingSuggestionApplicationEntity,
    ];

    expect(agencyEntities).toEqual(expect.arrayContaining(briefingEntities));
    expect(getAgencyTypeOrmConfig().entities).toBe(agencyEntities);
  });
});
