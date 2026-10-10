// Pure signature-state logic shared by the Autentique webhook and the manual
// `signature-sync` fallback. Nothing here touches the database or the network,
// so ordering and duplicate behaviour are unit-testable.
//
// Autentique does not guarantee webhook ordering and may deliver an event more
// than once, so every transition is monotonic: a status only ever moves up its
// rank, and a lower-ranked event arriving late is a no-op.

import { createHmac, timingSafeEqual } from 'crypto';
import { ContractPartySignatureStatus, ContractStatus } from '../enums';
import type {
  AutentiqueDocument,
  AutentiqueSignature,
} from './autentique.client';

// ─── Webhook signature ───────────────────────────────────────────────────────

/**
 * Verifies `x-autentique-signature`: hex HMAC-SHA256 of the raw request body.
 * Tolerates an optional `sha256=` prefix. Never throws.
 */
export function verifyAutentiqueWebhookSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  secret: string,
) {
  if (!rawBody || !signatureHeader || !secret) return false;

  const received = signatureHeader.trim().replace(/^sha256=/i, '');
  if (!/^[0-9a-f]+$/i.test(received)) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const receivedBuffer = Buffer.from(received, 'hex');

  return (
    receivedBuffer.length === expected.length &&
    timingSafeEqual(receivedBuffer, expected)
  );
}

// ─── Normalized snapshot ─────────────────────────────────────────────────────

export type AutentiqueSignerState = {
  publicId: string | null;
  email: string | null;
  name: string | null;
  signingUrl: string | null;
  status: ContractPartySignatureStatus;
  at: string | null;
  reason: string | null;
};

export type AutentiqueDocumentSnapshot = {
  documentId: string;
  signers: AutentiqueSignerState[];
  /** Autentique reported the document as finished (every signer signed). */
  finished: boolean;
  signedFileUrl: string | null;
};

export type AutentiqueWebhookEvent = {
  eventId: string | null;
  type: string;
  occurredAt: string | null;
  snapshot: AutentiqueDocumentSnapshot | null;
};

export const AUTENTIQUE_HANDLED_EVENT_TYPES = new Set([
  'signature.viewed',
  'signature.accepted',
  'signature.rejected',
  'signature.delivery_failed',
  'document.finished',
]);

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

// Webhook payloads carry timestamps as strings; GraphQL returns `{ created_at }`.
function stampOf(value: unknown): string | null {
  return asString(value) ?? asString(asRecord(value)?.created_at);
}

function reasonOf(value: unknown): string | null {
  return asString(asRecord(value)?.reason);
}

function signerStateFrom(
  raw: UnknownRecord,
  fallback?: { status: ContractPartySignatureStatus; at: string | null },
): AutentiqueSignerState {
  const user = asRecord(raw.user);
  const mail = asRecord(raw.mail) ?? asRecord(raw.email_events);
  const events = Array.isArray(raw.events) ? raw.events.map(asRecord) : [];
  const rejectedEvent = events.find((event) => event?.type === 'rejected');

  const rejectedAt = stampOf(raw.rejected);
  const signedAt = stampOf(raw.signed);
  const viewedAt = stampOf(raw.viewed);
  const deliveryFailedAt = asString(mail?.refused);

  let status: ContractPartySignatureStatus = ContractPartySignatureStatus.Sent;
  let at: string | null = null;
  let reason: string | null = null;

  if (rejectedAt) {
    status = ContractPartySignatureStatus.Refused;
    at = rejectedAt;
    reason = reasonOf(raw.rejected) ?? asString(rejectedEvent?.reason);
  } else if (signedAt) {
    status = ContractPartySignatureStatus.Signed;
    at = signedAt;
  } else if (viewedAt) {
    status = ContractPartySignatureStatus.Viewed;
    at = viewedAt;
  } else if (deliveryFailedAt) {
    status = ContractPartySignatureStatus.Failed;
    at = deliveryFailedAt;
    reason = asString(mail?.reason);
  }

  // The event type is authoritative when the object lacks the timestamp.
  if (fallback && PARTY_RANK[fallback.status] > PARTY_RANK[status]) {
    status = fallback.status;
    at = fallback.at;
    if (status === ContractPartySignatureStatus.Failed)
      reason = asString(mail?.reason);
  }

  return {
    publicId: asString(raw.public_id),
    email:
      (asString(raw.email) ?? asString(user?.email))?.toLowerCase() ?? null,
    name: asString(raw.name) ?? asString(user?.name),
    signingUrl: asString(asRecord(raw.link)?.short_link),
    status,
    at,
    reason,
  };
}

/** Normalizes a `document(id)` query result. */
export function snapshotFromDocument(
  document: AutentiqueDocument,
): AutentiqueDocumentSnapshot {
  const signers = (document.signatures ?? []).map(
    (signature: AutentiqueSignature) =>
      signerStateFrom(signature as unknown as UnknownRecord),
  );

  return {
    documentId: document.id,
    signers,
    finished:
      signers.length > 0 &&
      signers.every(
        (signer) => signer.status === ContractPartySignatureStatus.Signed,
      ),
    signedFileUrl: asString(document.files?.signed),
  };
}

const SIGNATURE_EVENT_STATUS: Record<string, ContractPartySignatureStatus> = {
  'signature.viewed': ContractPartySignatureStatus.Viewed,
  'signature.accepted': ContractPartySignatureStatus.Signed,
  'signature.rejected': ContractPartySignatureStatus.Refused,
  'signature.delivery_failed': ContractPartySignatureStatus.Failed,
};

/**
 * Parses an Autentique webhook body. The documented envelope is
 * `{ id, object: "webhook", event: { id, type, data, created_at } }`; the
 * resource sits either at `event.data.object` or directly at `event.data`
 * (both appear in the docs). A bare `{ type, data }` event is also accepted.
 * Returns null when the body is not an event at all.
 */
export function parseAutentiqueWebhookEvent(
  body: unknown,
): AutentiqueWebhookEvent | null {
  const envelope = asRecord(body);
  if (!envelope) return null;

  const event = asRecord(envelope.event) ?? envelope;
  const type = asString(event.type);
  if (!type) return null;

  const data = asRecord(event.data);
  const resource = asRecord(data?.object) ?? data;
  const occurredAt = asString(event.created_at);
  const eventId = asString(event.id);

  if (!resource || !AUTENTIQUE_HANDLED_EVENT_TYPES.has(type)) {
    return { eventId, type, occurredAt, snapshot: null };
  }

  if (type.startsWith('signature.')) {
    const documentId = asString(resource.document);
    if (!documentId) return { eventId, type, occurredAt, snapshot: null };

    return {
      eventId,
      type,
      occurredAt,
      snapshot: {
        documentId,
        signers: [
          signerStateFrom(resource, {
            status: SIGNATURE_EVENT_STATUS[type],
            at: occurredAt,
          }),
        ],
        finished: false,
        signedFileUrl: null,
      },
    };
  }

  // document.finished
  const documentId = asString(resource.id);
  if (!documentId) return { eventId, type, occurredAt, snapshot: null };

  const signatures = Array.isArray(resource.signatures)
    ? resource.signatures
        .map(asRecord)
        .filter((item): item is UnknownRecord => Boolean(item))
    : [];

  return {
    eventId,
    type,
    occurredAt,
    snapshot: {
      documentId,
      signers: signatures.map((signature) => signerStateFrom(signature)),
      finished: true,
      signedFileUrl: asString(asRecord(resource.files)?.signed),
    },
  };
}

// ─── Monotonic transitions ───────────────────────────────────────────────────

// Signed and Refused are both terminal: neither overrides the other.
export const PARTY_RANK: Record<ContractPartySignatureStatus, number> = {
  [ContractPartySignatureStatus.Pending]: 0,
  [ContractPartySignatureStatus.Sent]: 1,
  [ContractPartySignatureStatus.Failed]: 2,
  [ContractPartySignatureStatus.Viewed]: 3,
  [ContractPartySignatureStatus.Signed]: 4,
  [ContractPartySignatureStatus.Refused]: 4,
};

const CONTRACT_RANK: Partial<Record<ContractStatus, number>> = {
  [ContractStatus.PendingSignature]: 0,
  [ContractStatus.SentForSignature]: 1,
  [ContractStatus.PartiallySigned]: 2,
  [ContractStatus.DigitallySigned]: 3,
  [ContractStatus.Completed]: 4,
};

/** Statuses a party may be moved out of to reach `target` (strictly lower rank). */
export function partyStatusesBelow(target: ContractPartySignatureStatus) {
  return (Object.keys(PARTY_RANK) as ContractPartySignatureStatus[]).filter(
    (status) => PARTY_RANK[status] < PARTY_RANK[target],
  );
}

/** Contract statuses that may advance to `target` (strictly lower rank). */
export function contractStatusesBelow(target: ContractStatus) {
  const targetRank = CONTRACT_RANK[target];
  if (targetRank === undefined) return [];
  return (Object.keys(CONTRACT_RANK) as ContractStatus[]).filter(
    (status) => (CONTRACT_RANK[status] ?? Infinity) < targetRank,
  );
}

export function isContractInSignatureFlow(status: ContractStatus) {
  return CONTRACT_RANK[status] !== undefined;
}

export type SignaturePartyLike = {
  id: string;
  email: string | null;
  signatureStatus: ContractPartySignatureStatus;
  metadata: Record<string, unknown> | null;
};

export type PartyTransition = {
  partyId: string;
  from: ContractPartySignatureStatus;
  to: ContractPartySignatureStatus;
  at: string | null;
  reason: string | null;
  externalSignerId: string | null;
  signingUrl: string | null;
};

export type SignatureTransitionPlan = {
  partyTransitions: PartyTransition[];
  /** Status every party ends up with once the plan is applied. */
  resultingStatuses: Map<string, ContractPartySignatureStatus>;
  allSigned: boolean;
  nextContractStatus: ContractStatus | null;
};

function matchSigner(
  party: SignaturePartyLike,
  signers: AutentiqueSignerState[],
) {
  const externalSignerId = asString(party.metadata?.externalSignerId);
  if (externalSignerId) {
    return (
      signers.find((signer) => signer.publicId === externalSignerId) ?? null
    );
  }

  const email = party.email?.trim().toLowerCase();
  if (!email) return null;
  return signers.find((signer) => signer.email === email) ?? null;
}

export function planSignatureTransitions(
  contractStatus: ContractStatus,
  parties: SignaturePartyLike[],
  snapshot: AutentiqueDocumentSnapshot,
): SignatureTransitionPlan {
  const partyTransitions: PartyTransition[] = [];
  const resultingStatuses = new Map<string, ContractPartySignatureStatus>();

  for (const party of parties) {
    const signer = matchSigner(party, snapshot.signers);
    let resulting = party.signatureStatus;

    if (signer) {
      // A finished document means every signer signed, whatever the
      // per-signature payload carried.
      const incoming = snapshot.finished
        ? ContractPartySignatureStatus.Signed
        : signer.status;

      if (PARTY_RANK[incoming] > PARTY_RANK[party.signatureStatus]) {
        resulting = incoming;
        partyTransitions.push({
          partyId: party.id,
          from: party.signatureStatus,
          to: incoming,
          at: signer.at,
          reason: signer.reason,
          externalSignerId: signer.publicId,
          signingUrl: signer.signingUrl,
        });
      }
    }

    resultingStatuses.set(party.id, resulting);
  }

  const statuses = [...resultingStatuses.values()];
  const allSigned =
    statuses.length > 0 &&
    statuses.every((status) => status === ContractPartySignatureStatus.Signed);
  const anySigned = statuses.some(
    (status) => status === ContractPartySignatureStatus.Signed,
  );

  let target: ContractStatus | null = null;
  // `document.finished` is Autentique's word that the document is fully
  // signed, even if a local party could not be matched to a signature.
  if (allSigned || snapshot.finished) target = ContractStatus.DigitallySigned;
  else if (anySigned) target = ContractStatus.PartiallySigned;

  const currentRank = CONTRACT_RANK[contractStatus];
  const nextContractStatus =
    target !== null &&
    currentRank !== undefined &&
    (CONTRACT_RANK[target] ?? -1) > currentRank
      ? target
      : null;

  return { partyTransitions, resultingStatuses, allSigned, nextContractStatus };
}
