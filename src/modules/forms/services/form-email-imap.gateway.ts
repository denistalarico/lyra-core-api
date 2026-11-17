import { Injectable } from '@nestjs/common';
import { ImapFlow } from 'imapflow';

/**
 * F4 (§6.3): the only place that talks IMAP. The mailbox is opened
 * read-only (EXAMINE) and every fetch is BODY.PEEK in imapflow, so the
 * agency's box is never marked as read, moved or deleted.
 */

export type ImapCredentials = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
};

export type ImapHeaderRow = { uid: number; size: number; headers: string };

export type ImapSession = {
  uidValidity: string;
  uidNext: number;
  /** UIDs received since the date (cursor reset). */
  searchSince(date: Date): Promise<number[]>;
  /** Recipient headers only, for UIDs > after (or the given list). */
  headers(
    range: { after: number } | { uids: number[] },
  ): Promise<ImapHeaderRow[]>;
  source(uid: number): Promise<Buffer | null>;
  close(): Promise<void>;
};

/** Only these are read for every message; bodies only for our addresses. */
export const RECIPIENT_HEADERS = [
  'to',
  'cc',
  'delivered-to',
  'x-original-to',
  'message-id',
];

@Injectable()
export class FormEmailImapGateway {
  async open(credentials: ImapCredentials): Promise<ImapSession> {
    const client = new ImapFlow({
      host: credentials.host,
      port: credentials.port,
      secure: credentials.secure,
      auth: { user: credentials.user, pass: credentials.password },
      logger: false,
      disableAutoIdle: true,
      connectionTimeout: 20_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
    });
    // Unhandled 'error' events would crash the process.
    client.on('error', () => undefined);
    await client.connect();
    let lock: { release(): void } | null = null;
    try {
      lock = await client.getMailboxLock('INBOX', { readOnly: true });
      const mailbox = client.mailbox;
      if (!mailbox) throw new Error('INBOX could not be opened.');
      const close = async () => {
        lock?.release();
        await client.logout().catch(() => client.close());
      };
      return {
        uidValidity: String(mailbox.uidValidity),
        uidNext: mailbox.uidNext,
        searchSince: async (date) =>
          (await client.search({ since: date }, { uid: true })) || [],
        headers: async (range) => {
          const target =
            'after' in range ? `${range.after + 1}:*` : range.uids.join(',');
          if (!target) return [];
          // fetchAll: no other command may run while a fetch is iterating.
          const rows = await client.fetchAll(
            target,
            { uid: true, size: true, headers: RECIPIENT_HEADERS },
            { uid: true },
          );
          return rows
            .filter((row) => !('after' in range) || row.uid > range.after)
            .map((row) => ({
              uid: row.uid,
              size: row.size ?? 0,
              headers: row.headers?.toString('utf8') ?? '',
            }));
        },
        source: async (uid) => {
          const row = await client.fetchOne(
            String(uid),
            { source: true },
            { uid: true },
          );
          return row ? (row.source ?? null) : null;
        },
        close,
      };
    } catch (error) {
      lock?.release();
      await client.logout().catch(() => client.close());
      throw error;
    }
  }
}

/** Unfolded recipient header values (message-id excluded) + the Message-ID. */
export function parseRecipientHeaders(raw: string): {
  recipients: string;
  messageId: string | null;
} {
  const lines = raw.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/);
  const recipients: string[] = [];
  let messageId: string | null = null;
  for (const line of lines) {
    const match = /^([a-z-]+):\s*(.*)$/i.exec(line);
    if (!match) continue;
    const name = match[1].toLowerCase();
    if (name === 'message-id')
      messageId = match[2].trim().slice(0, 998) || null;
    else recipients.push(match[2]);
  }
  return { recipients: recipients.join(', '), messageId };
}
