import { ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

const E164 = /^\+[1-9]\d{7,14}$/;

export type PilotOutboundAuthorization = {
  canonicalE164: string;
  transportRecipient: string;
  recipientHash: string;
  recipientMasked: string;
};

/**
 * Normalizes and validates a WhatsApp recipient to E.164 for outbound send.
 * The pilot-phase recipient allowlist that used to gate this has been
 * retired — the product is out of the restricted test phase, so any
 * well-formed number is accepted.
 */
@Injectable()
export class InboxPilotOutboundPolicyService {
  authorize(
    recipient: string,
    expectedRecipient?: string | null,
  ): PilotOutboundAuthorization {
    const canonicalE164 = canonicalizeRecipient(recipient);
    if (expectedRecipient) {
      const expected = canonicalizeRecipient(expectedRecipient);
      if (canonicalE164 !== expected) {
        throw new ForbiddenException('outbound_recipient_changed');
      }
    }
    return {
      canonicalE164,
      transportRecipient: canonicalE164.slice(1),
      recipientHash: createHash('sha256').update(canonicalE164).digest('hex'),
      recipientMasked: maskRecipient(canonicalE164),
    };
  }

  isAuthorized(recipient: string | null | undefined): boolean {
    if (!recipient) return false;
    try {
      this.authorize(recipient, recipient);
      return true;
    } catch {
      return false;
    }
  }
}

export function canonicalizeRecipient(value: string): string {
  const trimmed = value.trim();
  const canonical = trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
  if (!E164.test(canonical)) {
    throw new ForbiddenException('outbound_recipient_invalid');
  }
  return canonical;
}

function maskRecipient(value: string): string {
  return `${value.slice(0, 3)}${'*'.repeat(Math.max(4, value.length - 7))}${value.slice(-4)}`;
}
