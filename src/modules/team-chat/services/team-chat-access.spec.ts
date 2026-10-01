import { evaluateChannelAccess, isElevatedRole } from './team-chat-access';
import { TeamChatChannelVisibility } from '../enums';

/**
 * The authorization rule itself (CCOM0.5 §6, §7, §8). `assertChannelAccess`
 * composes these decisions with the repositories; the rule is unit-tested here
 * so the matrix is readable without database fixtures.
 */

const channel = {
  id: 'channel-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  visibility: TeamChatChannelVisibility.PRIVATE,
};

const member = { userId: 'user-a', leftAt: null };

describe('isElevatedRole', () => {
  it.each([
    ['owner', true],
    ['admin', true],
    ['administrator', true],
    // Not widened by CCOM0.5: manager was never elevated for channel lists.
    ['manager', false],
    ['member', false],
    [undefined, false],
  ])('treats %s as elevated=%s', (role, expected) => {
    expect(isElevatedRole(role)).toBe(expected);
  });
});

describe('evaluateChannelAccess', () => {
  const context = {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    userId: 'user-a',
    role: 'member',
  };

  it('allows an active participant of a private channel', () => {
    expect(evaluateChannelAccess(context, channel, member)).toEqual({
      allowed: true,
      via: 'participant',
    });
  });

  it('denies a non-member of a private channel', () => {
    expect(evaluateChannelAccess(context, channel, null)).toEqual({
      allowed: false,
      reason: 'not_a_participant',
    });
  });

  it('denies a member who has left the channel', () => {
    expect(
      evaluateChannelAccess(context, channel, {
        userId: 'user-a',
        leftAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).toEqual({ allowed: false, reason: 'not_a_participant' });
  });

  it('denies another tenant even with a membership row', () => {
    expect(
      evaluateChannelAccess(
        { ...context, tenantId: 'tenant-b' },
        channel,
        member,
      ),
    ).toEqual({ allowed: false, reason: 'tenant_mismatch' });
  });

  it('denies another workspace even with a membership row', () => {
    expect(
      evaluateChannelAccess(
        { ...context, workspaceId: 'workspace-b' },
        channel,
        member,
      ),
    ).toEqual({ allowed: false, reason: 'workspace_mismatch' });
  });

  it('denies an unauthenticated context', () => {
    expect(
      evaluateChannelAccess({ ...context, userId: null }, channel, null),
    ).toEqual({ allowed: false, reason: 'unauthenticated' });
  });

  it('allows owner and admin without a membership row (documented bypass)', () => {
    expect(
      evaluateChannelAccess({ ...context, role: 'owner' }, channel, null),
    ).toEqual({ allowed: true, via: 'elevated_role' });
    expect(
      evaluateChannelAccess({ ...context, role: 'admin' }, channel, null),
    ).toEqual({ allowed: true, via: 'elevated_role' });
  });

  it('does not extend the bypass to manager', () => {
    expect(
      evaluateChannelAccess({ ...context, role: 'manager' }, channel, null),
    ).toEqual({ allowed: false, reason: 'not_a_participant' });
  });

  it('allows any workspace user into a workspace-visible channel', () => {
    expect(
      evaluateChannelAccess(
        context,
        { ...channel, visibility: TeamChatChannelVisibility.WORKSPACE },
        null,
      ),
    ).toEqual({ allowed: true, via: 'workspace_visibility' });
  });

  it.each([
    TeamChatChannelVisibility.CLIENT_CONTEXT,
    TeamChatChannelVisibility.PROJECT_CONTEXT,
  ])('requires participation for %s visibility', (visibility) => {
    // CCOM0.5 §9: these labels keep their existing behaviour and gain no new
    // semantics; they are simply authorized consistently with `private`.
    expect(
      evaluateChannelAccess(context, { ...channel, visibility }, null),
    ).toEqual({ allowed: false, reason: 'not_a_participant' });
    expect(
      evaluateChannelAccess(context, { ...channel, visibility }, member),
    ).toEqual({ allowed: true, via: 'participant' });
  });

  it('checks tenant and workspace before the elevated bypass', () => {
    // An owner of tenant A is not an owner of tenant B's channel.
    expect(
      evaluateChannelAccess(
        { ...context, role: 'owner', tenantId: 'tenant-b' },
        channel,
        null,
      ),
    ).toEqual({ allowed: false, reason: 'tenant_mismatch' });
  });
});
