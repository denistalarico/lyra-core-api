import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import type { SocialScheduledBoostEntity } from '../entities';
import type { SocialBoostRequestService } from './social-boost-request.service';
import { SocialScheduledBoostService } from './social-scheduled-boost.service';

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  agencyClientId: null,
  companyContextId: null,
};
const publicationId = '33333333-3333-4333-8333-333333333333';
const templateId = '44444444-4444-4444-8444-444444444444';
const connectionId = '55555555-5555-4555-8555-555555555555';

function publicationRow(placement = 'feed') {
  return {
    id: publicationId,
    content_item_id: '66666666-6666-4666-8666-666666666666',
    status: 'scheduled',
    provider: 'meta',
    external_asset_id: '123',
    asset_type: 'facebook_page',
    placement,
    asset_metadata: {},
    connection_metadata: {},
  };
}

function setup() {
  const boosts = {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(async (value) => ({ id: 'new-id', ...value })),
    create: jest.fn((value) => value),
  };
  const dataSource = {
    query: jest.fn(),
    transaction: jest.fn(),
  };
  const boostRequests = {
    evaluateSchedulable: jest.fn().mockResolvedValue(null),
    preflight: jest.fn(),
    confirm: jest.fn(),
  };
  const service = new SocialScheduledBoostService(
    boosts as unknown as Repository<SocialScheduledBoostEntity>,
    dataSource as unknown as DataSource,
    boostRequests as unknown as SocialBoostRequestService,
  );
  return { service, boosts, dataSource, boostRequests };
}

describe('SocialScheduledBoostService', () => {
  const dto = {
    publicationId,
    templateId,
    connectionId,
    spendAcknowledged: true as const,
  };

  it('records the authorization and spend acknowledgement as pending', async () => {
    const { service, boosts, dataSource } = setup();
    dataSource.query.mockResolvedValue([publicationRow()]);

    await service.schedule(scope, 'user-1', dto);

    expect(boosts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending',
        publicationId,
        boostTemplateId: templateId,
        authorizedById: 'user-1',
        spendAcknowledgedAt: expect.any(Date),
      }),
    );
  });

  it('refuses a Story, a policy block and a second live boost', async () => {
    const story = setup();
    story.dataSource.query.mockResolvedValue([publicationRow('story')]);
    await expect(
      story.service.schedule(scope, null, dto),
    ).rejects.toBeInstanceOf(BadRequestException);

    const blocked = setup();
    blocked.dataSource.query.mockResolvedValue([publicationRow()]);
    blocked.boostRequests.evaluateSchedulable.mockResolvedValue(
      'boost_disabled_by_policy',
    );
    await expect(blocked.service.schedule(scope, null, dto)).rejects.toThrow(
      'boost_disabled_by_policy',
    );

    const duplicate = setup();
    duplicate.dataSource.query.mockResolvedValue([publicationRow()]);
    duplicate.boosts.findOne.mockResolvedValue({ status: 'pending' });
    await expect(
      duplicate.service.schedule(scope, null, dto),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(duplicate.boosts.save).not.toHaveBeenCalled();
  });

  it('executes a published post through preflight + confirmation keyed on the row id', async () => {
    const { service, boosts, dataSource, boostRequests } = setup();
    dataSource.query.mockResolvedValue([]);
    dataSource.transaction.mockImplementation(async (callback) =>
      callback({
        query: jest
          .fn()
          .mockResolvedValueOnce([{ id: 'boost-1' }])
          .mockResolvedValueOnce([]),
      }),
    );
    boosts.findOne.mockResolvedValue({
      id: 'boost-1',
      ...scope,
      publicationId,
      boostTemplateId: templateId,
      connectionId,
      authorizedById: 'user-1',
      status: 'executing',
    });
    boostRequests.preflight.mockResolvedValue({
      id: 'request-1',
      status: 'pending_confirmation',
      errorCode: null,
    });
    boostRequests.confirm.mockResolvedValue({
      id: 'request-1',
      status: 'created_active',
      errorCode: null,
    });

    await expect(service.runDue()).resolves.toBe(1);

    expect(boostRequests.preflight).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: scope.tenantId }),
      'user-1',
      expect.objectContaining({ requestId: 'boost-1', publicationId }),
    );
    expect(boostRequests.confirm).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      'request-1',
      'boost-1',
    );
    expect(boosts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'executed',
        boostRequestId: 'request-1',
        errorCode: null,
      }),
    );
  });

  it('marks a refused Meta creation as failed with the provider code', async () => {
    const { service, boosts, dataSource, boostRequests } = setup();
    dataSource.query.mockResolvedValue([]);
    dataSource.transaction.mockImplementation(async (callback) =>
      callback({
        query: jest
          .fn()
          .mockResolvedValueOnce([{ id: 'boost-1' }])
          .mockResolvedValueOnce([]),
      }),
    );
    boosts.findOne.mockResolvedValue({ id: 'boost-1', ...scope });
    boostRequests.preflight.mockResolvedValue({
      id: 'request-1',
      status: 'pending_confirmation',
    });
    boostRequests.confirm.mockResolvedValue({
      id: 'request-1',
      status: 'failed',
      errorCode: 'provider_account_or_billing_issue',
    });

    await service.runDue();

    expect(boosts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errorCode: 'provider_account_or_billing_issue',
      }),
    );
  });
});
