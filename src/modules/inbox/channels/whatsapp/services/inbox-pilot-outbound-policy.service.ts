import { ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';

const E164 = /^\+[1-9]\d{7,14}$/;

export type PilotOutboundAuthorization = {
  canonicalE164: string;
  transportRecipient: string;
  recipientHash: string;
  recipientMasked: string;
};

@Injectable()
export class InboxPilotOutboundPolicyService implements OnModuleInit {
  readonly pilotMode = process.env.INBOX_PILOT_MODE === 'true';
  private readonly allowed = this.readAllowlist();

  onModuleInit(): void {
    if (this.pilotMode && this.allowed.size === 0) {
      throw new Error('inbox_pilot_allowlist_missing');
    }
  }

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
    if (this.pilotMode && !this.allowed.has(canonicalE164)) {
      throw new ForbiddenException('outbound_recipient_not_allowlisted');
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

  private readAllowlist(): Set<string> {
    if (!this.pilotMode) return new Set();
    const primary = process.env.INBOX_PILOT_ALLOWED_SENDERS_E164?.trim();
    const legacy = process.env.INBOX_TEST_ALLOWED_SENDER_E164?.trim();
    const raw = primary || legacy || '';
    if (!raw) return new Set();
    const values = raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (values.some((item) => !E164.test(item))) {
      throw new Error('inbox_pilot_allowlist_invalid');
    }
    return new Set(values);
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
