import { AgentActivationPolicyService } from './agent-activation-policy.service';

/** IX3 (D-IX-6): the comment rule is its own; `every_eligible` never answers. */
describe('AgentActivationPolicyService.evaluateComment', () => {
  function service(
    commentActivationPolicy: Record<string, unknown> | undefined,
    overrides: { channel?: Record<string, unknown>; binding?: unknown } = {},
  ) {
    const channel = {
      id: 'c',
      status: 'active',
      connectionStatus: 'connected',
      aiEnabled: true,
      defaultAgentId: 'a',
      ...overrides.channel,
    };
    const agent = {
      id: 'a',
      status: 'active',
      publishedVersionId: 'v1',
      channelPolicy: {
        // The conversation rule must not leak into comments.
        activationPolicy: { trigger: 'every_eligible' },
        ...(commentActivationPolicy ? { commentActivationPolicy } : {}),
      },
      behaviorConfig: {},
    };
    const binding =
      'binding' in overrides
        ? overrides.binding
        : { id: 'b', status: 'active' };
    const repo = (entity: { name: string }) => ({
      findOneBy: jest
        .fn()
        .mockResolvedValue(
          entity.name.includes('InboxChannel') ? channel : agent,
        ),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(binding),
      }),
    });
    return new AgentActivationPolicyService({
      getRepository: jest.fn(repo),
    } as never);
  }
  const input = {
    tenantId: 't',
    workspaceId: 'w',
    channelId: 'c',
    text: 'Quero saber o PREÇO!',
    adId: null as string | null,
    fromOwnAccount: false,
  };

  it('keywords: activates on a whole-word match and carries the public reply text', async () => {
    const result = await service({
      trigger: 'keywords',
      keywords: ['preço'],
      publicReplyText: '  Te chamei no direct!  ',
    }).evaluateComment(input);
    expect(result).toMatchObject({
      wouldActivate: true,
      reasonCode: 'keyword_match',
      trigger: 'keywords',
      policyVersion: 'comment-activation-v1',
      resolved: { agentId: 'a', agentVersionId: 'v1', bindingId: 'b' },
      publicReplyText: 'Te chamei no direct!',
    });
    await expect(
      service({ trigger: 'keywords', keywords: ['orçamento'] }).evaluateComment(
        input,
      ),
    ).resolves.toMatchObject({
      wouldActivate: false,
      reasonCode: 'keyword_missing',
    });
  });

  it('ad_referral: only a comment on an ad that passes the existing ad filters', async () => {
    const policy = { trigger: 'ad_referral', adFilters: { adId: ['ad-1'] } };
    await expect(
      service(policy).evaluateComment({ ...input, adId: 'ad-1' }),
    ).resolves.toMatchObject({
      wouldActivate: true,
      reasonCode: 'trusted_ad_referral',
    });
    await expect(
      service(policy).evaluateComment({ ...input, adId: 'ad-2' }),
    ).resolves.toMatchObject({
      wouldActivate: false,
      reasonCode: 'ad_comment_missing',
    });
    await expect(
      service({ trigger: 'ad_referral' }).evaluateComment(input),
    ).resolves.toMatchObject({
      wouldActivate: false,
      reasonCode: 'ad_comment_missing',
    });
  });

  it('every_eligible is refused even when stored, and no rule means off', async () => {
    await expect(
      service({ trigger: 'every_eligible' }).evaluateComment(input),
    ).resolves.toMatchObject({
      wouldActivate: false,
      reasonCode: 'comment_trigger_refused',
    });
    await expect(
      service(undefined).evaluateComment(input),
    ).resolves.toMatchObject({
      wouldActivate: false,
      reasonCode: 'manual_required',
    });
  });

  it('the usual exclusions apply: own page, opt-out, internal, AI off, no binding', async () => {
    const policy = { trigger: 'keywords', keywords: ['preço'] };
    const cases: Array<[Record<string, unknown>, string, object?]> = [
      [{ fromOwnAccount: true }, 'own_account_comment'],
      [{ contactOptOut: true }, 'contact_opt_out'],
      [{ internalContact: true }, 'internal_contact'],
      [{}, 'channel_ai_disabled', { channel: { aiEnabled: false } }],
      [{}, 'binding_ineligible', { binding: null }],
    ];
    for (const [extra, exclusion, overrides] of cases) {
      const result = await service(policy, overrides).evaluateComment({
        ...input,
        ...extra,
      });
      expect(result.wouldActivate).toBe(false);
      expect(result.exclusions).toContain(exclusion);
    }
  });
});
