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
import type { SocialApprovalsService } from './social-approvals.service';

describe('SocialApprovalsController AP1 Agency boundary', () => {
  const approvals = {
    list: jest.fn(), detail: jest.fn(), create: jest.fn(), submit: jest.fn(),
    comment: jest.fn(), approveInternal: jest.fn(), requestChanges: jest.fn(), cancel: jest.fn(),
  };
  const controller = new SocialApprovalsController(approvals as unknown as SocialApprovalsService);

  beforeEach(() => jest.clearAllMocks());

  it('is guarded as a Social Agency controller and applies every AP1 permission explicitly', () => {
    expect(Reflect.getMetadata(PATH_METADATA, SocialApprovalsController)).toBe('social/approvals');
    expect(Reflect.getMetadata(GUARDS_METADATA, SocialApprovalsController)).toEqual([JwtAuthGuard, PermissionsGuard]);
    expect(Reflect.getMetadata(PRODUCT_ENTITLEMENT_METADATA, SocialApprovalsController)).toBe('social');
    expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, SocialApprovalsController.prototype.list)).toBe('social.approvals.review.view.assigned');
    expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, SocialApprovalsController.prototype.detail)).toBe('social.approvals.review.view.assigned');
    expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, SocialApprovalsController.prototype.comment)).toBe('social.approvals.review.comment.assigned');
    expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, SocialApprovalsController.prototype.requestChanges)).toBe('social.approvals.review.request_changes.manager');
    expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, SocialApprovalsController.prototype.approveInternal)).toBe('social.approvals.review.approve_internal.manager');
    expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, SocialApprovalsController.prototype.cancel)).toBe('social.approvals.review.override.owner_or_admin_explicit');
  });

  it('passes a server-resolved company scope and fails closed without it', async () => {
    const context: RequestContext = {
      tenantId: 'tenant-a', workspaceId: 'workspace-a', userId: 'user-a',
      managedContext: { productKey: 'social', operatingMode: 'client', clientId: 'client-a', companyContextId: 'company-a', managedTenantId: null },
    };
    await controller.list(context, {});
    expect(approvals.list).toHaveBeenCalledWith(expect.objectContaining({ agencyClientId: 'client-a', companyContextId: 'company-a' }), {});
    const contextWithoutCompany: RequestContext = {
      ...context,
      managedContext: {
        productKey: 'social', operatingMode: 'client', clientId: 'client-a',
        companyContextId: null, managedTenantId: null,
      },
    };
    expect(() => controller.list(contextWithoutCompany, {})).toThrow(BadRequestException);
  });

  it('exposes no Agency handler capable of submitting a client-stage decision or a caller-supplied actor', () => {
    const handlers = SocialApprovalsController.prototype as unknown as Record<string, unknown>;
    expect(handlers.clientApprove).toBeUndefined();
    expect(handlers.clientRequestChanges).toBeUndefined();
  });
});
