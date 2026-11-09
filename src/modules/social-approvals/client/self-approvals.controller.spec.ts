import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import {
  CLIENT_AREA_MODULE_KEY,
  CLIENT_AREA_PERMISSION_KEY,
} from '../../client-area/client-area.decorators';
import {
  ClientAreaMembershipGuard,
  ClientAreaSelfContextGuard,
} from '../../client-area/guards/client-area.guards';
import { SOCIAL_CLIENT_AREA_ROUTES } from '../../social-client-area/social-client-area.routes';
import { SelfApprovalsController } from './self-approvals.controller';

const HANDLERS = [
  'list',
  'board',
  'piece',
  'detail',
  'preview',
  'view',
  'comment',
  'approve',
  'requestChanges',
  'media',
  'download',
] as const;

describe('D-24 self approvals boundary', () => {
  const prototype = SelfApprovalsController.prototype as unknown as Record<
    string,
    object
  >;

  it('lives under the self path and requires the self context, never a membership', () => {
    expect(Reflect.getMetadata(PATH_METADATA, SelfApprovalsController)).toBe(
      'client-area/self/approvals',
    );
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      SelfApprovalsController,
    ) as unknown[];
    expect(guards).toContain(ClientAreaSelfContextGuard);
    expect(guards).not.toContain(ClientAreaMembershipGuard);
    expect(
      Reflect.getMetadata(CLIENT_AREA_MODULE_KEY, SelfApprovalsController),
    ).toBe('approvals');
  });

  it.each(HANDLERS)('%s declares a Client Area permission', (handler) => {
    expect(
      Reflect.getMetadata(CLIENT_AREA_PERMISSION_KEY, prototype[handler]),
    ).toMatch(/^client_area\.approvals\./);
  });

  it('decisions need the decide key, not just view', () => {
    for (const handler of ['approve', 'requestChanges'])
      expect(
        Reflect.getMetadata(CLIENT_AREA_PERMISSION_KEY, prototype[handler]),
      ).toBe('client_area.approvals.decide');
  });

  it('exposes no Agency-only action', () => {
    const names = Object.getOwnPropertyNames(SelfApprovalsController.prototype);
    for (const forbidden of [
      'submit',
      'create',
      'cancel',
      'agencyOverride',
      'finish',
      'createStandalone',
    ])
      expect(names).not.toContain(forbidden);
  });

  it('adds nothing to the company Bridge', () => {
    expect(
      Object.keys(SOCIAL_CLIENT_AREA_ROUTES).filter((route) =>
        route.includes('approvals'),
      ),
    ).toEqual([]);
  });
});
