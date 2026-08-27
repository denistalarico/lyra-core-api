import * as automationEntities from '../modules/leadflow-automations/entities';
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

  // `autoLoadEntities` is false, so a `TypeOrmModule.forFeature([...], 'agency')`
  // does NOT put an entity on the data source: this list is the only thing that
  // does. Miss one and the class still injects fine — it fails later, at the
  // first query, with "No metadata for X was found". Naming the entities one by
  // one is what let LeadFlowWebhookDeliveryEntity slip through, so this asserts
  // the whole module export instead: a new entity is covered the day it is added.
  it('registers every LeadFlow Automations entity in the runtime data source', () => {
    // O index exporta as classes e um `type`, que não sobrevive à compilação:
    // em tempo de execução só restam os construtores.
    const exported = Object.values(automationEntities).filter(
      (value) => typeof value === 'function',
    );

    expect(exported.length).toBeGreaterThan(0);
    expect(agencyEntities).toEqual(expect.arrayContaining(exported));
  });
});
