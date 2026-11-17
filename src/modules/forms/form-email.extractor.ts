import { randomBytes } from 'crypto';
import { normalizeCapture } from './form-capture.mapper';
import { normalizeEmail, normalizePhone } from './form-submission.normalizer';
import type {
  CapturedField,
  FormCaptureTarget,
  NormalizedSubmission,
} from './forms.types';

/**
 * F4 (§6.5) — pure helpers for leads that arrive by e-mail: addresses,
 * forwarding confirmations and rule-based extraction. No network here.
 */

const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_IN_TEXT =
  /(?:\+?55[\s.-]?)?\(?\b\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/;
/** Technical senders: never the visitor (§6.5.3). */
const TECHNICAL_LOCAL =
  /^(no-?reply|do-?not-?reply|wordpress|mailer(-daemon)?|postmaster|bounce[s]?|root|www-data|apache|nginx|cpanel|server)$/i;
const MAX_PAIRS = 60;
const MAX_TEXT = 20_000;

export type ParsedEmail = {
  messageId: string | null;
  subject: string | null;
  from: string | null;
  replyTo: string | null;
  date: string | null;
  text: string;
};

export function extractAddresses(value: string | null | undefined): string[] {
  if (!value) return [];
  const found: string[] = value.match(EMAIL_IN_TEXT) ?? [];
  return [...new Set(found.map((address) => address.toLowerCase()))];
}

export function slugForForm(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '');
  return `${base || 'form'}-${randomBytes(2).toString('hex')}`;
}

/** `caixa@agencia.com.br` + slug → `caixa+slug@agencia.com.br`. */
export function buildPlusAddress(mailbox: string, slug: string): string {
  const [local, domain] = mailbox.toLowerCase().split('@');
  return `${local.split('+')[0]}+${slug}@${domain}`;
}

export function isValidAddress(value: string): boolean {
  return normalizeEmail(value) !== null;
}

/** Exact address or `@domain`; empty list = anyone. */
export function isSenderAllowed(
  sender: string | null,
  allowedSenders: string[],
): boolean {
  if (!allowedSenders.length) return true;
  const address = extractAddresses(sender)[0];
  if (!address) return false;
  return allowedSenders.some((rule) =>
    rule.startsWith('@') ? address.endsWith(rule) : address === rule,
  );
}

export function htmlToText(html: string): string {
  return html
    .slice(0, 200_000)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanCell(html: string): string {
  return htmlToText(html).replace(/\s+/g, ' ').trim();
}

/** "Campo: valor" / "Campo = valor" lines and 2-column HTML tables (§6.5.3 i–ii). */
export function extractPairs(
  text: string,
  html: string | null,
): CapturedField[] {
  const pairs: Array<[string, string]> = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([^:=\n]{1,60}?)\s*[:=]\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    const [, label, value] = match;
    // "https://…" or a quoted reply header ("Em seg., … escreveu:") is not a field.
    if (value.startsWith('//') || !/[a-zà-ú]/i.test(label)) continue;
    if (/escreveu$|wrote$/i.test(value)) continue;
    pairs.push([label, value]);
  }
  if (html) {
    const row =
      /<tr[^>]*>\s*<t[hd][^>]*>([\s\S]*?)<\/t[hd]>\s*<t[hd][^>]*>([\s\S]*?)<\/t[hd]>\s*<\/tr>/gi;
    for (const match of html.slice(0, 200_000).matchAll(row)) {
      const label = cleanCell(match[1]).replace(/:$/, '').trim();
      const value = cleanCell(match[2]);
      if (label && value && label.length <= 60) pairs.push([label, value]);
    }
  }
  const seen = new Map<string, CapturedField>();
  for (const [rawLabel, rawValue] of pairs) {
    const label = rawLabel.replace(/^[\s*>-]+/, '').trim();
    const value = rawValue.trim().slice(0, 5000);
    if (!label || !value || seen.has(label) || seen.size >= MAX_PAIRS) continue;
    seen.set(label, {
      key: label.slice(0, 120),
      label,
      type: 'text',
      autocomplete: null,
      hint: null,
      value,
    });
  }
  return [...seen.values()];
}

function isLeadAddress(address: string, excluded: Set<string>): boolean {
  const [local, domain] = address.split('@');
  if (!domain || excluded.has(address)) return false;
  if (TECHNICAL_LOCAL.test(local.split('+')[0])) return false;
  // Any address of the agency box itself (sub-addresses included).
  for (const own of excluded) {
    const [ownLocal, ownDomain] = own.split('@');
    if (ownDomain === domain && local.split('+')[0] === ownLocal.split('+')[0])
      return false;
  }
  return true;
}

export type EmailExtraction = {
  fields: CapturedField[];
  normalized: NormalizedSubmission;
};

/**
 * Rules in the order of §6.5.3: pairs → synonyms (same mapper as the capture
 * script) → regex for e-mail/phone in the body → Reply-To. `From` is never
 * the lead: PHP/WordPress send from the server.
 */
export function extractEmailLead(
  email: ParsedEmail & { html: string | null },
  options: {
    ownAddresses: string[];
    fieldMap?: Record<string, FormCaptureTarget>;
    /** Reprocess: pairs stored at arrival (HTML tables are not kept). */
    fields?: CapturedField[];
  },
): EmailExtraction {
  const fields = options.fields ?? extractPairs(email.text, email.html);
  const normalized = normalizeCapture(fields, options.fieldMap ?? {});
  const excluded = new Set(
    [...options.ownAddresses, ...extractAddresses(email.from)].map((a) =>
      a.toLowerCase(),
    ),
  );
  const { lead } = normalized;
  // Unmapped pair values (e.g. "Campo 4") also count for the regex fallback.
  const haystack = [email.text, ...fields.map((field) => field.value)].join(
    '\n',
  );

  if (!lead.email) {
    const found = extractAddresses(haystack).find((address) =>
      isLeadAddress(address, excluded),
    );
    if (found) lead.email = normalizeEmail(found);
  }
  if (!lead.phone) {
    const found = PHONE_IN_TEXT.exec(haystack);
    if (found) lead.phone = normalizePhone(found[0]);
  }
  if (!lead.email) {
    const replyTo = extractAddresses(email.replyTo).find((address) =>
      isLeadAddress(address, excluded),
    );
    if (replyTo) lead.email = normalizeEmail(replyTo);
  }
  if (!fields.length && !normalized.opportunity.notes && email.text.trim())
    normalized.opportunity.notes = email.text.trim().slice(0, 2000);
  if (email.subject)
    normalized.summaryLines.unshift(
      `Assunto do e-mail: ${email.subject.slice(0, 200)}`,
    );
  normalized.extractedBy = 'rules';
  return { fields, normalized };
}

/** AI runs only when the rules found no way to reach the lead (§6.5.4). */
export function needsAiExtraction(normalized: NormalizedSubmission): boolean {
  return !normalized.lead.email && !normalized.lead.phone;
}

export type ForwardingConfirmation = {
  url: string | null;
  from: string | null;
  subject: string | null;
};

/** Gmail/Outlook "confirm forwarding" mails: shown in the UI, never a lead (§6.5.2). */
export function detectForwardingConfirmation(email: {
  from: string | null;
  subject: string | null;
  text: string;
}): ForwardingConfirmation | null {
  const from = (email.from ?? '').toLowerCase();
  const subject = email.subject ?? '';
  const isConfirmation =
    from.includes('forwarding-noreply@google.com') ||
    /(forwarding confirmation|confirma[cç][aã]o de encaminhamento|encaminhamento de e-?mail|confirm(e|ar)? (o )?encaminhamento|confirm forwarding)/i.test(
      subject,
    );
  if (!isConfirmation) return null;
  const urls = email.text.match(/https:\/\/[^\s<>"')]+/g) ?? [];
  const url =
    urls.find((u) => /google\.com|microsoft|live\.com|outlook/i.test(u)) ??
    urls[0] ??
    null;
  return {
    url: url ? url.slice(0, 1000) : null,
    from: email.from?.slice(0, 200) ?? null,
    subject: subject.slice(0, 200) || null,
  };
}

export function trimStoredText(text: string): string {
  return text.slice(0, MAX_TEXT);
}
