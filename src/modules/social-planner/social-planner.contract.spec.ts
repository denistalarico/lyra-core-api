import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../permissions/decorators/permissions.decorators';
import {
  SocialContentDestinationEntity,
  SocialContentItemEntity,
  SocialContentRevisionEntity,
  SocialPlanEntity,
  SocialPlannerSettingsEntity,
  SocialPublishingCadenceEntity,
} from './entities';
import { SocialPlannerController } from './social-planner.controller';
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
  });
});
