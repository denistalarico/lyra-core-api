import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { agencyEntities } from '../../config/typeorm.config';
import { AgencyDataSource } from '../../database/agency-typeorm.datasource';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../permissions/decorators/permissions.decorators';
import {
  SocialCampaignInstanceEntity,
  SocialCampaignTemplateEntity,
  SocialContentDestinationEntity,
  SocialContentIdeaEntity,
  SocialContentItemEntity,
  SocialContentRevisionEntity,
  SocialEditorialPillarEntity,
  SocialPlanEntity,
  SocialPlannerSettingsEntity,
  SocialPublishingCadenceEntity,
} from './entities';
import { SocialPlannerController } from './social-planner.controller';
import { SocialCampaignService } from './services/social-campaign.service';
import { SocialPlannerService } from './services/social-planner.service';
import { SocialPlannerSettingsService } from './services/social-planner-settings.service';
import { SocialPublishingCadenceService } from './services/social-publishing-cadence.service';

describe('Social Planner contract', () => {
  it('keeps every Planner repository on the agency datasource', () => {
    expect(getRepositoryToken(SocialPlanEntity, 'agency')).toBeDefined();
    expect(
      getRepositoryToken(SocialContentItemEntity, 'agency'),
    ).toBeDefined();
    expect(
      getRepositoryToken(SocialContentDestinationEntity, 'agency'),
    ).toBeDefined();
    expect(
      getRepositoryToken(SocialContentRevisionEntity, 'agency'),
    ).toBeDefined();
    expect(
      getRepositoryToken(SocialPlannerSettingsEntity, 'agency'),
    ).toBeDefined();
    expect(
      getRepositoryToken(SocialPublishingCadenceEntity, 'agency'),
    ).toBeDefined();
  });

  /**
   * Neither list has a glob. An entity missing from `agencyEntities` fails at
   * runtime with "No metadata found", and a migration missing from the
   * datasource simply never runs — the table stays absent in production while
   * every test passes.
   */
  it('registers every Planner entity in agencyEntities', () => {
    for (const entity of [
      SocialPlanEntity,
      SocialContentItemEntity,
      SocialContentDestinationEntity,
      SocialContentRevisionEntity,
      SocialPlannerSettingsEntity,
      SocialPublishingCadenceEntity,
      SocialCampaignTemplateEntity,
      SocialCampaignInstanceEntity,
      SocialEditorialPillarEntity,
      SocialContentIdeaEntity,
    ]) {
      expect(agencyEntities).toContain(entity);
    }
  });

  it('registers the E5 migration in the agency datasource', () => {
    const registered = (
      AgencyDataSource.options.migrations ?? []
    ) as Array<{ name?: string }>;

    expect(
      registered.some(
        (migration) =>
          migration?.name === 'CreateSocialCampaignsPillarsIdeas1792500000000',
      ),
    ).toBe(true);
  });

  it('binds Planner routes to the Social entitlement', () => {
    expect(
      Reflect.getMetadata(
        PRODUCT_ENTITLEMENT_METADATA,
        SocialPlannerController,
      ),
    ).toBe('social');
  });

  it('keeps strategic reads under the current Planner view permission', () => {
    const handlers = [
      SocialPlannerController.prototype.listPlans,
      SocialPlannerController.prototype.getPlan,
      SocialPlannerController.prototype.listContent,
      SocialPlannerController.prototype.getContent,
      SocialPlannerController.prototype.listRevisions,
      SocialPlannerController.prototype.getSettings,
      SocialPlannerController.prototype.getCadence,
    ];

    for (const handler of handlers) {
      expect(
        Reflect.getMetadata(
          PERMISSION_KEY_METADATA,
          handler,
        ),
      ).toBe('social.planner.calendar.view.client');
    }
  });

  it('keeps Planner writes under manager-level permissions', () => {
    const createHandlers = [
      SocialPlannerController.prototype.createPlan,
      SocialPlannerController.prototype.createContent,
    ];

    for (const handler of createHandlers) {
      expect(
        Reflect.getMetadata(
          PERMISSION_KEY_METADATA,
          handler,
        ),
      ).toBe('social.planner.calendar.create.manager');
    }

    const updateHandlers = [
      SocialPlannerController.prototype.updatePlan,
      SocialPlannerController.prototype.archivePlan,
      SocialPlannerController.prototype.updateContent,
      SocialPlannerController.prototype.replaceDestinations,
      SocialPlannerController.prototype.createRevision,
      SocialPlannerController.prototype.restoreRevision,
      SocialPlannerController.prototype.updateSettings,
      SocialPlannerController.prototype.updateCadence,
    ];

    for (const handler of updateHandlers) {
      expect(
        Reflect.getMetadata(
          PERMISSION_KEY_METADATA,
          handler,
        ),
      ).toBe('social.planner.calendar.update.manager');
    }
  });

  it('does not require Social Integrations in the Planner application services', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        SocialPlannerService,
        SocialPlannerSettingsService,
        SocialPublishingCadenceService,
        SocialCampaignService,

        {
          provide: getRepositoryToken(
            SocialCampaignTemplateEntity,
            'agency',
          ),
          useValue: {},
        },
        {
          provide: getRepositoryToken(
            SocialCampaignInstanceEntity,
            'agency',
          ),
          useValue: {},
        },
        {
          provide: getRepositoryToken(
            SocialEditorialPillarEntity,
            'agency',
          ),
          useValue: {},
        },
        {
          provide: getRepositoryToken(
            SocialContentIdeaEntity,
            'agency',
          ),
          useValue: {},
        },
        {
          provide: getRepositoryToken(
            SocialPlanEntity,
            'agency',
          ),
          useValue: {},
        },
        {
          provide: getRepositoryToken(
            SocialContentItemEntity,
            'agency',
          ),
          useValue: {},
        },
        {
          provide: getRepositoryToken(
            SocialContentDestinationEntity,
            'agency',
          ),
          useValue: {},
        },
        {
          provide: getRepositoryToken(
            SocialContentRevisionEntity,
            'agency',
          ),
          useValue: {},
        },
        {
          provide: getRepositoryToken(
            SocialPlannerSettingsEntity,
            'agency',
          ),
          useValue: {},
        },
        {
          provide: getRepositoryToken(
            SocialPublishingCadenceEntity,
            'agency',
          ),
          useValue: {},
        },
      ],
    }).compile();

    expect(
      moduleRef.get(SocialPlannerService),
    ).toBeInstanceOf(SocialPlannerService);

    expect(
      moduleRef.get(SocialPlannerSettingsService),
    ).toBeInstanceOf(SocialPlannerSettingsService);

    expect(
      moduleRef.get(SocialPublishingCadenceService),
    ).toBeInstanceOf(SocialPublishingCadenceService);

    expect(
      moduleRef.get(SocialCampaignService),
    ).toBeInstanceOf(SocialCampaignService);
  });

  it('governs campaigns with the social.campaigns keys, not the Planner ones', () => {
    /**
     * A campaign is a Social-wide object. Putting it under
     * `social.planner.*` would mean a client granted Creative Studio access
     * but not the Planner could never see the campaign its own assets belong
     * to.
     */
    const viewHandlers = [
      SocialPlannerController.prototype.listCampaigns,
      SocialPlannerController.prototype.listCampaignTemplates,
    ];

    for (const handler of viewHandlers) {
      expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, handler)).toBe(
        'social.campaigns.campaign.view.client',
      );
    }

    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialPlannerController.prototype.createCampaign,
      ),
    ).toBe('social.campaigns.campaign.create.manager');

    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialPlannerController.prototype.updateCampaign,
      ),
    ).toBe('social.campaigns.campaign.update.manager');
  });

  it('treats converting a backlog idea as content creation, not as an edit', () => {
    // Conversion writes a new content item, so it must not be reachable with
    // only the permission to reorder the backlog.
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialPlannerController.prototype.convertIdea,
      ),
    ).toBe('social.planner.calendar.create.manager');

    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialPlannerController.prototype.discardIdea,
      ),
    ).toBe('social.planner.calendar.update.manager');
  });
});
