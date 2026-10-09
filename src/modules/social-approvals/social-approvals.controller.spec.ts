import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../permissions/decorators/permissions.decorators';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import type { RequestContext } from '../../common/context/request-context.interface';
import { SocialApprovalsController } from './social-approvals.controller';
import type { SocialApprovalInboxService } from './social-approval-inbox.service';
import type { SocialApprovalsService } from './social-approvals.service';
import {
  APPROVAL_OWNER_ACTION_REQUIRED,
  APPROVAL_SUBJECT_OWNER_ACTIONS,
  ApprovalOwnerActionRequiredException,
} from './approval-owner-actions';

describe('SocialApprovalsController AP1 Agency boundary', () => {
  const approvals = {
    list: jest.fn(),
    detail: jest.fn(),
    create: jest.fn(),
    submit: jest.fn(),
    comment: jest.fn(),
    approveInternal: jest.fn(),
    requestChanges: jest.fn(),
    cancel: jest.fn(),
  };
  const inbox = { list: jest.fn() };
  const controller = new SocialApprovalsController(
    approvals as unknown as SocialApprovalsService,
    inbox as unknown as SocialApprovalInboxService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('is guarded as a Social Agency controller and applies every AP1 permission explicitly', () => {
    expect(Reflect.getMetadata(PATH_METADATA, SocialApprovalsController)).toBe(
      'social/approvals',
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SocialApprovalsController),
    ).toEqual([JwtAuthGuard, PermissionsGuard]);
    expect(
      Reflect.getMetadata(
        PRODUCT_ENTITLEMENT_METADATA,
        SocialApprovalsController,
      ),
    ).toBe('social');
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialApprovalsController.prototype.list,
      ),
    ).toBe('social.approvals.review.view.assigned');
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialApprovalsController.prototype.detail,
      ),
    ).toBe('social.approvals.review.view.assigned');
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialApprovalsController.prototype.inboxList,
      ),
    ).toBe('social.approvals.review.view.assigned');
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialApprovalsController.prototype.comment,
      ),
    ).toBe('social.approvals.review.comment.assigned');
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialApprovalsController.prototype.requestChanges,
      ),
    ).toBe('social.approvals.review.request_changes.manager');
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialApprovalsController.prototype.approveInternal,
      ),
    ).toBe('social.approvals.review.approve_internal.manager');
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        SocialApprovalsController.prototype.cancel,
      ),
    ).toBe('social.approvals.review.override.owner_or_admin_explicit');
  });

  it('passes a server-resolved company scope and fails closed without it', async () => {
    const context: RequestContext = {
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      userId: 'user-a',
      managedContext: {
        productKey: 'social',
        operatingMode: 'client',
        clientId: 'client-a',
        companyContextId: 'company-a',
        managedTenantId: null,
      },
    };
    await controller.list(context, {});
    expect(approvals.list).toHaveBeenCalledWith(
      expect.objectContaining({
        agencyClientId: 'client-a',
        companyContextId: 'company-a',
      }),
      {},
    );
    const contextWithoutCompany: RequestContext = {
      ...context,
      managedContext: {
        productKey: 'social',
        operatingMode: 'client',
        clientId: 'client-a',
        companyContextId: null,
        managedTenantId: null,
      },
    };
    expect(() => controller.list(contextWithoutCompany, {})).toThrow(
      BadRequestException,
    );
  });

  describe('generic create respects owner-domain actions', () => {
    const context: RequestContext = {
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      userId: 'user-a',
      managedContext: {
        productKey: 'social',
        operatingMode: 'client',
        clientId: 'client-a',
        companyContextId: 'company-a',
        managedTenantId: null,
      },
    };
    const subject = {
      subjectId: '11111111-1111-4111-8111-111111111111',
      subjectRevisionId: '22222222-2222-4222-8222-222222222222',
    };

    it.each([
      ['creative_version', 'Creative Studio', '/social/creative-studio/'],
      ['planner_content_revision', 'Social Planner', '/social/planner/'],
    ])(
      'refuses %s with a stable 400 approval_owner_action_required',
      (subjectType, owner, route) => {
        let thrown: unknown;
        try {
          void controller.create(context, { subjectType, ...subject });
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(ApprovalOwnerActionRequiredException);
        expect(thrown).toBeInstanceOf(BadRequestException);
        const exception = thrown as BadRequestException;
        expect(exception.getStatus()).toBe(400);
        expect(exception.getResponse()).toMatchObject({
          statusCode: 400,
          code: APPROVAL_OWNER_ACTION_REQUIRED,
          subjectType,
          message: expect.stringContaining(owner),
          ownerAction: expect.stringContaining(route),
        });
        expect(approvals.create).not.toHaveBeenCalled();
      },
    );

    it('refuses before resolving scope, so even a context without company gets the owner error', () => {
      expect(() =>
        controller.create(
          { tenantId: 'tenant-a', workspaceId: 'workspace-a', userId: 'u' },
          { subjectType: 'creative_version', ...subject },
        ),
      ).toThrow(ApprovalOwnerActionRequiredException);
      expect(approvals.create).not.toHaveBeenCalled();
    });

    it('does not resolve inherited keys as owner actions', () => {
      expect(APPROVAL_SUBJECT_OWNER_ACTIONS.get('constructor')).toBeUndefined();
      expect(APPROVAL_SUBJECT_OWNER_ACTIONS.get('__proto__')).toBeUndefined();
    });

    it('keeps every workflow action delegating to the domain service', async () => {
      const id = '33333333-3333-4333-8333-333333333333';
      const scope = expect.objectContaining({
        agencyClientId: 'client-a',
        companyContextId: 'company-a',
      });

      await controller.submit(context, id);
      await controller.comment(context, id, { body: 'ok' });
      await controller.approveInternal(context, id);
      await controller.requestChanges(context, id, { body: 'ajuste' });
      await controller.cancel(context, id);

      expect(approvals.submit).toHaveBeenCalledWith(scope, id, 'user-a');
      expect(approvals.comment).toHaveBeenCalledWith(
        scope,
        id,
        'user-a',
        'ok',
        undefined,
      );
      expect(approvals.approveInternal).toHaveBeenCalledWith(
        scope,
        id,
        'user-a',
      );
      expect(approvals.requestChanges).toHaveBeenCalledWith(
        scope,
        id,
        'user-a',
        'ajuste',
      );
      expect(approvals.cancel).toHaveBeenCalledWith(scope, id, 'user-a');
    });
  });

  it('exposes no Agency handler capable of submitting a client-stage decision or a caller-supplied actor', () => {
    const handlers = SocialApprovalsController.prototype as unknown as Record<
      string,
      unknown
    >;
    expect(handlers.clientApprove).toBeUndefined();
    expect(handlers.clientRequestChanges).toBeUndefined();
  });

  it('CS5 Closeout: declares the cross-context inbox before `:id` and passes the request context through', async () => {
    const methods = Object.getOwnPropertyNames(
      SocialApprovalsController.prototype,
    );
    expect(methods.indexOf('inboxList')).toBeLessThan(
      methods.indexOf('detail'),
    );
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        SocialApprovalsController.prototype.inboxList,
      ),
    ).toBe('inbox');
    const ctx = { tenantId: 't', workspaceId: 'w', userId: 'u' };
    await controller.inboxList(ctx as RequestContext, { scope: 'own' });
    expect(inbox.list).toHaveBeenCalledWith(ctx, { scope: 'own' });
  });
});
