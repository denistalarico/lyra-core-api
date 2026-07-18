import {
  AgentActivationPolicyService,
  normalize,
} from './agent-activation-policy.service';

describe('AgentActivationPolicyService', () => {
  function service(policy: Record<string, unknown>) {
    const channel = {
      id: 'c',
      status: 'active',
      connectionStatus: 'connected',
      aiEnabled: true,
      defaultAgentId: 'a',
    };
    const agent = {
      id: 'a',
      status: 'active',
      publishedVersionId: 'v1',
      channelPolicy: { activationPolicy: policy },
    };
    const binding = { id: 'b', status: 'active' };
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

  it('normalizes keyword case and accents', async () => {
    expect(normalize('  ORÇAMENTO  Agora ')).toBe('orcamento agora');
    const result = await service({
      trigger: 'keywords',
      keywords: ['Orçamento'],
      keywordMode: 'word',
    }).evaluate({
      tenantId: 't',
      workspaceId: 'w',
      channelId: 'c',
      messageText: 'Quero ORÇAMENTO agora',
    });
    expect(result).toMatchObject({
      wouldActivate: true,
      reasonCode: 'keyword_match',
    });
  });

  it('matches a keyword next to punctuation without using a regular expression', async () => {
    const result = await service({
      trigger: 'keywords',
      keywords: ['Orçamento'],
      keywordMode: 'word',
    }).evaluate({
      tenantId: 't',
      workspaceId: 'w',
      channelId: 'c',
      messageText: 'Olá, orçamento?',
    });
    expect(result).toMatchObject({
      wouldActivate: true,
      reasonCode: 'keyword_match',
    });
  });

  it('does not trust free text claiming ad origin', async () => {
    const result = await service({ trigger: 'ad_referral' }).evaluate({
      tenantId: 't',
      workspaceId: 'w',
      channelId: 'c',
      messageText: 'vim do anúncio',
      referralTrusted: false,
    });
    expect(result).toMatchObject({
      wouldActivate: false,
      reasonCode: 'ad_referral_missing_or_untrusted',
    });
  });

  it('keeps manual as the safe default and all automatic effects false', async () => {
    const result = await service({ trigger: 'manual' }).evaluate({
      tenantId: 't',
      workspaceId: 'w',
      channelId: 'c',
    });
    expect(result).toMatchObject({
      wouldActivate: false,
      reasonCode: 'manual_required',
      automaticEffects: { reply: false, crm: false, followUp: false },
    });
  });

  it.each([
    { conversationState: 'paused', expected: 'conversation_human_or_closed' },
    { qualificationStatus: 'disqualified', expected: 'disqualified_contact' },
  ])(
    'applies mandatory exclusion $expected',
    async ({ expected, ...input }) => {
      const result = await service({ trigger: 'every_eligible' }).evaluate({
        tenantId: 't',
        workspaceId: 'w',
        channelId: 'c',
        ...input,
      });
      expect(result.wouldActivate).toBe(false);
      expect(result.exclusions).toContain(expected);
    },
  );
});
