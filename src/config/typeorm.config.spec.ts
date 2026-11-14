import * as automationEntities from '../modules/leadflow-automations/entities';
import {
  LeadFlowBriefingContextSnapshotEntity,
  LeadFlowBriefingExtractionJobEntity,
  LeadFlowBriefingSourceEntity,
  LeadFlowBriefingSourceVersionEntity,
  LeadFlowBriefingSuggestionApplicationEntity,
  LeadFlowBriefingSuggestionEntity,
} from '../modules/leadflow-briefing/entities';
import { UserProfileEntity } from '../modules/settings/entities/user-profile.entity';
import * as socialGa4Entities from '../modules/social-ga4/entities';
import * as socialGoogleEntities from '../modules/social-google/entities';
import * as socialApprovalEntities from '../modules/social-approvals/entities';
import * as socialProjectWorkEntities from '../modules/social-project-work/entities';
import { agencyEntities, getAgencyTypeOrmConfig } from './typeorm.config';

describe('Agency TypeORM configuration', () => {
  it('registers the canonical user profile used by the Client Area', () => {
    expect(agencyEntities).toContain(UserProfileEntity);
  });

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
  // AR1 added five approval entities that only reached `forFeature`, so every
  // real query on them would have failed while the Postgres specs, which list
  // their entities by hand, passed.
  it('registers every Social Approvals and work link entity', () => {
    const exported = [
      ...Object.values(socialApprovalEntities),
      ...Object.values(socialProjectWorkEntities),
    ].filter(
      (value) => typeof value === 'function' && /Entity$/.test(value.name),
    );

    expect(exported.length).toBeGreaterThanOrEqual(10);
    expect(agencyEntities).toEqual(expect.arrayContaining(exported));
  });

  it('registers every LeadFlow Automations entity in the runtime data source', () => {
    // O index exporta as classes e um `type`, que não sobrevive à compilação:
    // em tempo de execução só restam os construtores.
    const exported = Object.values(automationEntities).filter(
      (value) => typeof value === 'function',
    );

    expect(exported.length).toBeGreaterThan(0);
    expect(agencyEntities).toEqual(expect.arrayContaining(exported));
  });

  it('registers every Social Google OAuth entity in the runtime data source', () => {
    const exported = Object.values(socialGoogleEntities).filter(
      (value) => typeof value === 'function',
    );

    expect(exported).toHaveLength(4);
    expect(agencyEntities).toEqual(expect.arrayContaining(exported));
  });

  it('registers every Social GA4 read model entity in the runtime data source', () => {
    const exported = Object.values(socialGa4Entities).filter(
      (value) => typeof value === 'function' && /Entity$/.test(value.name),
    );

    expect(exported).toHaveLength(3);
    expect(agencyEntities).toEqual(expect.arrayContaining(exported));
  });
});
