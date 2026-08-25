import { BadRequestException } from '@nestjs/common';
import {
  MetaGraphError,
  classifyGraphAuthReason,
  classifyGraphResponse,
  classifyGraphTransportFailure,
  parseMetaGraphUsage,
  peakUsagePercent,
} from './meta-graph-error';

function headers(values: Record<string, string>) {
  return {
    get: (name: string) => values[name.toLowerCase()] ?? null,
  };
}

describe('classifyGraphResponse', () => {
  it('classifies the Marketing API rate-limit band', () => {
    // 80000..80004 is the business use-case band; 80000 is ads insights, which
    // is the one the read model will meet first.
    for (const code of [4, 17, 32, 341, 613, 80000, 80004]) {
      expect(
        classifyGraphResponse({
          httpStatus: 400,
          metaCode: code,
          metaSubcode: null,
        }),
      ).toBe('rate_limited');
    }
  });

  it('prefers the Meta code over the HTTP status', () => {
    // Meta answers 400 for almost everything, rate limits included. Trusting
    // the status would file "wait" under "give up".
    expect(
      classifyGraphResponse({
        httpStatus: 400,
        metaCode: 80000,
        metaSubcode: null,
      }),
    ).toBe('rate_limited');
  });

  it('classifies credential failures as auth', () => {
    for (const code of [10, 102, 190, 200, 294]) {
      expect(
        classifyGraphResponse({
          httpStatus: 400,
          metaCode: code,
          metaSubcode: null,
        }),
      ).toBe('auth');
    }
  });

  it('classifies an expired token subcode as auth', () => {
    expect(
      classifyGraphResponse({
        httpStatus: 400,
        metaCode: 190,
        metaSubcode: 463,
      }),
    ).toBe('auth');
  });

  it('classifies provider-side failures as transient', () => {
    expect(
      classifyGraphResponse({
        httpStatus: 500,
        metaCode: null,
        metaSubcode: null,
      }),
    ).toBe('transient');
    expect(
      classifyGraphResponse({
        httpStatus: 400,
        metaCode: 2,
        metaSubcode: null,
      }),
    ).toBe('transient');
  });

  it('classifies 429 as rate limited even without a Meta code', () => {
    expect(
      classifyGraphResponse({
        httpStatus: 429,
        metaCode: null,
        metaSubcode: null,
      }),
    ).toBe('rate_limited');
  });

  it('classifies a bad request as permanent', () => {
    // Retrying an invalid parameter forever is a bug, not resilience.
    expect(
      classifyGraphResponse({
        httpStatus: 400,
        metaCode: 100,
        metaSubcode: null,
      }),
    ).toBe('permanent');
  });
});

describe('classifyGraphAuthReason', () => {
  it('reads a dead token as credential_invalid', () => {
    // 102 (session invalid) and the whole 190 OAuthException family: the only
    // remedy is a human re-authorizing the connection.
    for (const [metaCode, metaSubcode] of [
      [102, null],
      [190, null],
      [190, 463], // expired
      [190, 467], // invalid
      [190, 460], // password changed
    ] as const) {
      expect(
        classifyGraphAuthReason({ httpStatus: 400, metaCode, metaSubcode }),
      ).toBe('credential_invalid');
    }
  });

  it('reads a missing permission as permission_denied', () => {
    // The distinction that matters: these tokens are alive. Re-authorizing
    // with the same roles produces the same failure, so a scheduler must not
    // treat them as a reason to stop the connection.
    for (const metaCode of [10, 200, 294]) {
      expect(
        classifyGraphAuthReason({
          httpStatus: 400,
          metaCode,
          metaSubcode: null,
        }),
      ).toBe('permission_denied');
    }
  });

  it('lets a subcode override its code', () => {
    // 190/492 is an OAuthException by code and an authorization problem in
    // fact: the token is valid, the identity is not an admin of the object.
    expect(
      classifyGraphAuthReason({
        httpStatus: 400,
        metaCode: 190,
        metaSubcode: 492,
      }),
    ).toBe('permission_denied');
  });

  it('refuses to guess when Meta gives no code', () => {
    // An unexplained 401 is not evidence a token is dead. Whatever policy
    // eventually parks connections needs proof, and this is the honest "no".
    for (const httpStatus of [401, 403]) {
      expect(
        classifyGraphAuthReason({
          httpStatus,
          metaCode: null,
          metaSubcode: null,
        }),
      ).toBe('auth_unclassified');
    }
  });
});

describe('MetaGraphError.authReason', () => {
  it('is derived without a second call site to forget', () => {
    const error = new MetaGraphError({
      kind: 'auth',
      safeMessage: 'Meta Ads account lookup failed.',
      httpStatus: 400,
      metaCode: 190,
      metaSubcode: 463,
    });

    expect(error.kind).toBe('auth');
    expect(error.authReason).toBe('credential_invalid');
  });

  it('separates the two auth outcomes on the same kind', () => {
    const denied = new MetaGraphError({
      kind: 'auth',
      safeMessage: 'Meta Ads account lookup failed.',
      httpStatus: 400,
      metaCode: 200,
      metaSubcode: null,
    });

    expect(denied.kind).toBe('auth');
    expect(denied.authReason).toBe('permission_denied');
  });

  it('is null for every other kind', () => {
    for (const kind of ['transient', 'rate_limited', 'permanent'] as const) {
      expect(
        new MetaGraphError({ kind, safeMessage: 'nope', metaCode: 190 })
          .authReason,
      ).toBeNull();
    }
  });
});

describe('classifyGraphTransportFailure', () => {
  it('classifies a timeout as transient', () => {
    const error = new Error('The operation was aborted due to timeout');
    error.name = 'TimeoutError';

    expect(classifyGraphTransportFailure(error)).toEqual({
      kind: 'transient',
      safeMessage: 'Meta Graph API request timed out.',
    });
  });

  it('classifies an abort as transient', () => {
    const error = new Error('aborted');
    error.name = 'AbortError';

    expect(classifyGraphTransportFailure(error).kind).toBe('transient');
  });

  it('never reuses the thrown message, which carries the URL', () => {
    const error = new Error(
      'ECONNRESET https://graph.facebook.com/v25.0/me?access_token=EAAG',
    );

    const classified = classifyGraphTransportFailure(error);

    expect(classified.safeMessage).toBe('Meta Graph API request failed.');
    expect(classified.safeMessage).not.toContain('EAAG');
  });
});

describe('parseMetaGraphUsage', () => {
  it('takes the worst percentage across every business bucket', () => {
    const usage = parseMetaGraphUsage(
      headers({
        'x-business-use-case-usage': JSON.stringify({
          '1238595766708820': [
            {
              type: 'ads_insights',
              call_count: 12,
              total_cputime: 44,
              total_time: 9,
            },
            {
              type: 'ads_management',
              call_count: 61,
              total_cputime: 3,
              total_time: 3,
            },
          ],
        }),
      }),
    );

    expect(usage.businessUseCasePercent).toBe(61);
  });

  it('converts estimated_time_to_regain_access from minutes', () => {
    const usage = parseMetaGraphUsage(
      headers({
        'x-business-use-case-usage': JSON.stringify({
          biz: [{ call_count: 100, estimated_time_to_regain_access: 5 }],
        }),
      }),
    );

    expect(usage.regainAccessInMs).toBe(300_000);
  });

  it('reads the ad account header when Meta sends it', () => {
    const usage = parseMetaGraphUsage(
      headers({
        'x-ad-account-usage': JSON.stringify({
          acc_id_util_pct: 9.67,
          reset_time_duration: 300,
        }),
      }),
    );

    expect(usage.adAccountPercent).toBeCloseTo(9.67);
  });

  it('reports no signal when the ad account header is absent', () => {
    // Observed in production: the insights edge sent the business header and
    // not this one. Absent must read as "unknown", never as "plenty left".
    const usage = parseMetaGraphUsage(
      headers({
        'x-business-use-case-usage': JSON.stringify({
          biz: [{ call_count: 1 }],
        }),
      }),
    );

    expect(usage.adAccountPercent).toBeNull();
  });

  it('converts Retry-After from seconds', () => {
    expect(
      parseMetaGraphUsage(headers({ 'retry-after': '120' })).retryAfterMs,
    ).toBe(120_000);
  });

  it('degrades to no signal on a malformed header', () => {
    const usage = parseMetaGraphUsage(
      headers({ 'x-business-use-case-usage': 'not json' }),
    );

    expect(usage.businessUseCasePercent).toBeNull();
  });

  it('tolerates a response with no headers at all', () => {
    expect(parseMetaGraphUsage(undefined).businessUseCasePercent).toBeNull();
  });
});

describe('peakUsagePercent', () => {
  it('reports the worst of the two signals', () => {
    expect(
      peakUsagePercent({
        businessUseCasePercent: 61,
        adAccountPercent: 90,
        regainAccessInMs: null,
        retryAfterMs: null,
      }),
    ).toBe(90);
  });

  it('reports null when neither header was present', () => {
    expect(
      peakUsagePercent({
        businessUseCasePercent: null,
        adAccountPercent: null,
        regainAccessInMs: null,
        retryAfterMs: null,
      }),
    ).toBeNull();
  });
});

describe('MetaGraphError', () => {
  it('stays an HTTP 400 so S1 callers keep their contract', () => {
    const error = new MetaGraphError({
      kind: 'rate_limited',
      safeMessage: 'Meta Ads account lookup failed.',
    });

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getStatus()).toBe(400);
    expect(error.kind).toBe('rate_limited');
  });

  it('prefers Retry-After over the estimated regain time', () => {
    const error = new MetaGraphError({
      kind: 'rate_limited',
      safeMessage: 'throttled',
      usage: {
        businessUseCasePercent: 100,
        adAccountPercent: null,
        regainAccessInMs: 600_000,
        retryAfterMs: 30_000,
      },
    });

    expect(error.retryAfterMs).toBe(30_000);
  });

  it('falls back to the estimated regain time when there is no Retry-After', () => {
    const error = new MetaGraphError({
      kind: 'rate_limited',
      safeMessage: 'throttled',
      usage: {
        businessUseCasePercent: 100,
        adAccountPercent: null,
        regainAccessInMs: 600_000,
        retryAfterMs: null,
      },
    });

    expect(error.retryAfterMs).toBe(600_000);
  });
});
