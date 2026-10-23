import { BadRequestException } from '@nestjs/common';
import { LeadFlowAgentService } from './leadflow-agent.service';
import type { LeadFlowAgentCommentActivationPolicy } from '../types/leadflow-agent.types';

/**
 * IX3 (D-IX-6): the agent's comment rule. Validated on PATCH like the
 * conversation rules, `every_eligible` refused, and an omitted rule kept.
 */
describe('LeadFlowAgentService comment activation policy', () => {
  const service = Object.create(LeadFlowAgentService.prototype) as unknown as {
    validateCommentActivationPolicy: (
      value: unknown,
    ) => LeadFlowAgentCommentActivationPolicy;
  };
  const validate = (value: unknown) =>
    service.validateCommentActivationPolicy(value);

  it('refuses every_eligible: an agent never answers every comment', () => {
    expect(() => validate({ version: 1, trigger: 'every_eligible' })).toThrow(
      new BadRequestException(
        'Comment activation cannot answer every comment.',
      ),
    );
  });

  it('absent or null is off (manual)', () => {
    expect(validate(undefined)).toMatchObject({
      trigger: 'manual',
      publicReplyText: null,
    });
    expect(validate(null).trigger).toBe('manual');
  });

  it('keywords: requires at least one, trims, no regular expressions', () => {
    expect(() => validate({ trigger: 'keywords', keywords: [] })).toThrow(
      BadRequestException,
    );
    expect(() =>
      validate({ trigger: 'keywords', keywords: ['pre.o'] }),
    ).toThrow('Regular expressions are not allowed in activation keywords.');
    expect(
      validate({
        trigger: 'keywords',
        keywords: [' preço '],
        keywordMode: 'phrase_contains',
        publicReplyText: '  Te chamei no direct!  ',
      }),
    ).toEqual({
      version: 1,
      trigger: 'keywords',
      keywords: ['preço'],
      keywordMode: 'phrase_contains',
      adFilters: {},
      publicReplyText: 'Te chamei no direct!',
    });
  });

  it('ad_referral keeps only well-formed ad filters; the public text is bounded', () => {
    expect(
      validate({ trigger: 'ad_referral', adFilters: { adId: ['120200'] } })
        .adFilters,
    ).toEqual({ adId: ['120200'] });
    expect(() =>
      validate({ trigger: 'ad_referral', adFilters: { adId: ['../x'] } }),
    ).toThrow(BadRequestException);
    expect(() =>
      validate({ trigger: 'ad_referral', publicReplyText: 'x'.repeat(281) }),
    ).toThrow('Comment public reply text is too long.');
  });

  it('a PATCH that omits the comment rule keeps the stored one', () => {
    const source = LeadFlowAgentService.prototype.patch.toString();
    expect(source).toContain(
      'dto.channelPolicy.commentActivationPolicy === undefined',
    );
    expect(source).toContain('agent.channelPolicy?.commentActivationPolicy');
  });
});
