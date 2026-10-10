import { createHmac } from 'crypto';
import { ContractPartySignatureStatus, ContractStatus } from '../enums';
import {
  parseAutentiqueWebhookEvent,
  planSignatureTransitions,
  snapshotFromDocument,
  verifyAutentiqueWebhookSignature,
  type AutentiqueDocumentSnapshot,
  type SignaturePartyLike,
} from './autentique-signature-state';

const SECRET = 'whsec_test';

function sign(body: string, secret = SECRET) {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function signatureEvent(
  type: string,
  overrides: Record<string, unknown> = {},
  eventId = 'evt-1',
) {
  return {
    id: 'webhook-1',
    object: 'webhook',
    event: {
      id: eventId,
      object: 'event',
      type,
      data: {
        public_id: 'sig-client',
        object: 'signature',
        user: { name: 'Cliente', email: 'Cliente@Example.com' },
        document: 'doc-1',
        viewed: null,
        signed: null,
        rejected: null,
        ...overrides,
      },
      created_at: '2026-10-10T12:00:00.000000Z',
    },
  };
}

function party(
  id: string,
  status: ContractPartySignatureStatus,
  externalSignerId: string | null,
  email: string,
): SignaturePartyLike {
  return {
    id,
    email,
    signatureStatus: status,
    metadata: externalSignerId ? { externalSignerId } : {},
  };
}

describe('verifyAutentiqueWebhookSignature', () => {
  const body = JSON.stringify({ event: { id: 'e', type: 'signature.viewed' } });
  const raw = Buffer.from(body);

  it('accepts a valid hex HMAC of the raw body', () => {
    expect(verifyAutentiqueWebhookSignature(raw, sign(body), SECRET)).toBe(
      true,
    );
    expect(
      verifyAutentiqueWebhookSignature(raw, `sha256=${sign(body)}`, SECRET),
    ).toBe(true);
  });

  it('rejects an HMAC made with another secret or over another body', () => {
    expect(
      verifyAutentiqueWebhookSignature(raw, sign(body, 'other'), SECRET),
    ).toBe(false);
    expect(
      verifyAutentiqueWebhookSignature(raw, sign(`${body} `), SECRET),
    ).toBe(false);
    expect(verifyAutentiqueWebhookSignature(raw, 'not-hex', SECRET)).toBe(
      false,
    );
    expect(verifyAutentiqueWebhookSignature(raw, 'abcd', SECRET)).toBe(false);
  });

  it('rejects a missing header, body or secret', () => {
    expect(verifyAutentiqueWebhookSignature(raw, undefined, SECRET)).toBe(
      false,
    );
    expect(
      verifyAutentiqueWebhookSignature(undefined, sign(body), SECRET),
    ).toBe(false);
    expect(verifyAutentiqueWebhookSignature(raw, sign(body), '')).toBe(false);
  });
});

describe('parseAutentiqueWebhookEvent', () => {
  it('reads a signature event from the documented envelope', () => {
    const event = parseAutentiqueWebhookEvent(
      signatureEvent('signature.accepted', {
        signed: '2026-10-10T12:00:00.000000Z',
      }),
    );

    expect(event?.eventId).toBe('evt-1');
    expect(event?.snapshot?.documentId).toBe('doc-1');
    expect(event?.snapshot?.signers[0]).toEqual(
      expect.objectContaining({
        publicId: 'sig-client',
        email: 'cliente@example.com',
        status: ContractPartySignatureStatus.Signed,
      }),
    );
  });

  it('falls back to the event type when the object lacks the timestamp', () => {
    const event = parseAutentiqueWebhookEvent(
      signatureEvent('signature.rejected'),
    );
    expect(event?.snapshot?.signers[0].status).toBe(
      ContractPartySignatureStatus.Refused,
    );
  });

  it('accepts the resource nested under data.object (document.finished)', () => {
    const event = parseAutentiqueWebhookEvent({
      event: {
        id: 'evt-fin',
        type: 'document.finished',
        data: {
          object: {
            id: 'doc-1',
            object: 'document',
            signatures: [
              {
                public_id: 'sig-client',
                email: 'c@example.com',
                signed: '2026-10-10T12:00:00Z',
              },
            ],
            files: {
              signed:
                'https://painel.autentique.com.br/documentos/doc-1/assinado.pdf',
            },
          },
        },
      },
    });

    expect(event?.snapshot).toEqual(
      expect.objectContaining({
        documentId: 'doc-1',
        finished: true,
        signedFileUrl:
          'https://painel.autentique.com.br/documentos/doc-1/assinado.pdf',
      }),
    );
  });

  it('ignores event types it does not handle', () => {
    const event = parseAutentiqueWebhookEvent(
      signatureEvent('signature.created'),
    );
    expect(event?.type).toBe('signature.created');
    expect(event?.snapshot).toBeNull();
  });

  it('returns null for a body that is not an event', () => {
    expect(parseAutentiqueWebhookEvent('x')).toBeNull();
    expect(parseAutentiqueWebhookEvent({ hello: 'world' })).toBeNull();
  });
});

describe('planSignatureTransitions', () => {
  const parties = () => [
    party(
      'p-agency',
      ContractPartySignatureStatus.Sent,
      'sig-agency',
      'agencia@example.com',
    ),
    party(
      'p-client',
      ContractPartySignatureStatus.Sent,
      'sig-client',
      'cliente@example.com',
    ),
  ];

  function snapshotOf(event: ReturnType<typeof signatureEvent>) {
    return parseAutentiqueWebhookEvent(event)!
      .snapshot as AutentiqueDocumentSnapshot;
  }

  it('moves a party forward and the contract to partially signed', () => {
    const plan = planSignatureTransitions(
      ContractStatus.SentForSignature,
      parties(),
      snapshotOf(signatureEvent('signature.accepted')),
    );

    expect(plan.partyTransitions).toEqual([
      expect.objectContaining({
        partyId: 'p-client',
        from: ContractPartySignatureStatus.Sent,
        to: ContractPartySignatureStatus.Signed,
      }),
    ]);
    expect(plan.nextContractStatus).toBe(ContractStatus.PartiallySigned);
  });

  it('ignores a late "viewed" delivered after "accepted" (out of order)', () => {
    const current = parties();
    current[1].signatureStatus = ContractPartySignatureStatus.Signed;

    const plan = planSignatureTransitions(
      ContractStatus.PartiallySigned,
      current,
      snapshotOf(
        signatureEvent('signature.viewed', { viewed: '2026-10-10T11:00:00Z' }),
      ),
    );

    expect(plan.partyTransitions).toEqual([]);
    expect(plan.nextContractStatus).toBeNull();
  });

  it('is a no-op when the same event is applied twice (duplicate delivery)', () => {
    const current = parties();
    const snapshot = snapshotOf(signatureEvent('signature.accepted'));

    const first = planSignatureTransitions(
      ContractStatus.SentForSignature,
      current,
      snapshot,
    );
    current[1].signatureStatus = first.resultingStatuses.get('p-client')!;

    const second = planSignatureTransitions(
      ContractStatus.PartiallySigned,
      current,
      snapshot,
    );
    expect(second.partyTransitions).toEqual([]);
    expect(second.nextContractStatus).toBeNull();
  });

  it('never turns a refusal into a signature', () => {
    const current = parties();
    current[1].signatureStatus = ContractPartySignatureStatus.Refused;

    const plan = planSignatureTransitions(
      ContractStatus.SentForSignature,
      current,
      snapshotOf(signatureEvent('signature.accepted')),
    );
    expect(plan.partyTransitions).toEqual([]);
  });

  it('reaches digitally signed when the last party signs, even if it arrives first', () => {
    const current = parties();
    // document.finished delivered before both signature.accepted events.
    const plan = planSignatureTransitions(
      ContractStatus.SentForSignature,
      current,
      {
        documentId: 'doc-1',
        finished: true,
        signedFileUrl: null,
        signers: [
          {
            publicId: 'sig-agency',
            email: null,
            name: null,
            signingUrl: null,
            status: ContractPartySignatureStatus.Viewed,
            at: null,
            reason: null,
          },
          {
            publicId: 'sig-client',
            email: null,
            name: null,
            signingUrl: null,
            status: ContractPartySignatureStatus.Sent,
            at: null,
            reason: null,
          },
        ],
      },
    );

    expect(plan.partyTransitions.map((t) => t.to)).toEqual([
      ContractPartySignatureStatus.Signed,
      ContractPartySignatureStatus.Signed,
    ]);
    expect(plan.allSigned).toBe(true);
    expect(plan.nextContractStatus).toBe(ContractStatus.DigitallySigned);
  });

  it('does not regress a completed contract', () => {
    const current = parties().map((p) => ({
      ...p,
      signatureStatus: ContractPartySignatureStatus.Signed,
    }));
    const plan = planSignatureTransitions(
      ContractStatus.Completed,
      current,
      snapshotOf(signatureEvent('signature.accepted')),
    );
    expect(plan.nextContractStatus).toBeNull();
  });

  it('matches by e-mail when the party has no external signer id yet', () => {
    const current = [
      party(
        'p-client',
        ContractPartySignatureStatus.Sent,
        null,
        'cliente@example.com',
      ),
    ];
    const plan = planSignatureTransitions(
      ContractStatus.SentForSignature,
      current,
      snapshotOf(signatureEvent('signature.viewed')),
    );
    expect(plan.partyTransitions[0]).toEqual(
      expect.objectContaining({
        partyId: 'p-client',
        externalSignerId: 'sig-client',
      }),
    );
  });

  it('normalizes a document(id) query result', () => {
    const snapshot = snapshotFromDocument({
      id: 'doc-1',
      files: {
        signed:
          'https://painel.autentique.com.br/documentos/doc-1/assinado.pdf',
      },
      signatures: [
        {
          public_id: 'a',
          email: 'a@x.com',
          signed: { created_at: '2026-10-10T10:00:00Z' },
        },
        {
          public_id: 'b',
          email: 'b@x.com',
          viewed: { created_at: '2026-10-10T09:00:00Z' },
        },
        {
          public_id: 'c',
          email: 'c@x.com',
          email_events: { refused: '2026-10-10 08:00:00', reason: 'bounce' },
        },
      ],
    });

    expect(snapshot.finished).toBe(false);
    expect(snapshot.signers.map((s) => s.status)).toEqual([
      ContractPartySignatureStatus.Signed,
      ContractPartySignatureStatus.Viewed,
      ContractPartySignatureStatus.Failed,
    ]);
    expect(snapshot.signers[2].reason).toBe('bounce');
  });
});
