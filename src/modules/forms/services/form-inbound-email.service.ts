import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { simpleParser } from 'mailparser';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import { AgencyWorkspaceEmailSettingsEntity } from '../../agency/entities/agency-settings.entities';
import { EmailService } from '../../email/email.service';
import type { UpdateFormInboundEmailDto } from '../dto/forms.dto';
import { FormEmailSyncStateEntity } from '../entities/form-email-sync-state.entity';
import { FormSubmissionEntity } from '../entities/form-submission.entity';
import { FormEntity } from '../entities/form.entity';
import { validateCapture } from '../form-config.validator';
import {
  buildPlusAddress,
  detectForwardingConfirmation,
  extractAddresses,
  extractEmailLead,
  htmlToText,
  isSenderAllowed,
  isValidAddress,
  needsAiExtraction,
  slugForForm,
  trimStoredText,
} from '../form-email.extractor';
import {
  DEFAULT_FORM_INBOUND_EMAIL,
  type FormInboundEmail,
} from '../forms.types';
import { FormEmailAiExtractor } from './form-email-ai.extractor';
import {
  FormEmailImapGateway,
  parseRecipientHeaders,
  type ImapCredentials,
} from './form-email-imap.gateway';
import { FormLeadIngestionService } from './form-lead-ingestion.service';
import { FormsAddonService } from './forms-addon.service';

const RESET_WINDOW_DAYS = 7;
const MAX_MESSAGES_PER_POLL = 300;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const RETENTION_DAYS = 90;

export function inboundEmailOf(
  form: Pick<FormEntity, 'inboundEmail'>,
): FormInboundEmail {
  return { ...DEFAULT_FORM_INBOUND_EMAIL, ...(form.inboundEmail ?? {}) };
}

/**
 * F4 (§6): leads by e-mail through the agency's IMAP box (`/settings/email`).
 * The reader looks at recipient headers of new UIDs only; a body is
 * downloaded just when a recipient is the address of an active form.
 */
@Injectable()
export class FormInboundEmailService {
  private readonly logger = new Logger(FormInboundEmailService.name);

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    @InjectRepository(FormEntity, 'agency')
    private readonly forms: Repository<FormEntity>,
    @InjectRepository(FormSubmissionEntity, 'agency')
    private readonly submissions: Repository<FormSubmissionEntity>,
    @InjectRepository(FormEmailSyncStateEntity, 'agency')
    private readonly syncStates: Repository<FormEmailSyncStateEntity>,
    @InjectRepository(AgencyWorkspaceEmailSettingsEntity, 'agency')
    private readonly emailSettings: Repository<AgencyWorkspaceEmailSettingsEntity>,
    private readonly crypto: SettingsCryptoService,
    private readonly imap: FormEmailImapGateway,
    private readonly mailer: EmailService,
    private readonly ai: FormEmailAiExtractor,
    private readonly addon: FormsAddonService,
    private readonly ingestion: FormLeadIngestionService,
  ) {}

  // ── Admin ────────────────────────────────────────────────────────────────

  async status(ctx: RequestContext) {
    const { tenantId, workspaceId } = scopeOf(ctx);
    await this.addon.assertEnabled(tenantId, workspaceId);
    const [credentials, state] = await Promise.all([
      this.credentials(tenantId, workspaceId),
      this.syncStates.findOne({ where: { tenantId, workspaceId } }),
    ]);
    return {
      imapConfigured: Boolean(credentials),
      mailbox: credentials?.user ?? null,
      aiAvailable: this.ai.enabled,
      lastPolledAt: state?.lastPolledAt ?? null,
      lastSuccessAt: state?.lastSuccessAt ?? null,
      lastError: state?.lastError ?? null,
    };
  }

  /** "Testar conexão IMAP" in /settings/email: login + EXAMINE INBOX, nothing read. */
  async testConnection(ctx: RequestContext) {
    const { tenantId, workspaceId } = scopeOf(ctx);
    const credentials = await this.credentials(tenantId, workspaceId);
    if (!credentials)
      return {
        ok: false,
        error:
          'Preencha servidor, usuário e senha IMAP e salve antes de testar.',
      };
    try {
      const session = await this.imap.open(credentials);
      await session.close();
      return { ok: true, error: null, mailbox: credentials.user };
    } catch (error) {
      return { ok: false, error: imapErrorMessage(error, credentials.host) };
    }
  }

  async configure(
    ctx: RequestContext,
    form: FormEntity,
    dto: UpdateFormInboundEmailDto,
  ) {
    const settings = inboundEmailOf(form);
    if (dto.allowedSenders !== undefined)
      settings.allowedSenders = validateSenders(dto.allowedSenders);
    if (dto.aiExtraction !== undefined)
      settings.aiExtraction = dto.aiExtraction;

    if (!dto.enabled) {
      form.inboundEmailAddress = null;
      form.inboundEmail = { ...settings, verifiedAt: null, pendingTest: null };
      return this.forms.save(form);
    }

    const credentials = await this.credentials(form.tenantId, form.workspaceId);
    if (!credentials)
      throw new BadRequestException({
        code: 'FORMS_IMAP_NOT_CONFIGURED',
        message: 'Configure a caixa IMAP da agência em Configurações → E-mail.',
      });
    const mailbox = credentials.user.toLowerCase();
    const kind = dto.kind ?? settings.kind;
    let address: string;
    if (kind === 'alias') {
      address = (dto.address ?? '').trim().toLowerCase();
      if (!isValidAddress(address))
        throw new BadRequestException('Informe um e-mail válido para o alias.');
      if (address === mailbox)
        throw new BadRequestException(
          'O alias precisa ser diferente da caixa principal.',
        );
    } else {
      const current = form.inboundEmailAddress;
      const [local, domain] = mailbox.split('@');
      const keep =
        settings.kind === 'plus' &&
        current?.startsWith(`${local.split('+')[0]}+`) &&
        current.endsWith(`@${domain}`);
      address =
        keep && current
          ? current
          : buildPlusAddress(mailbox, slugForForm(form.name));
    }

    const taken = await this.forms.findOne({
      where: {
        tenantId: form.tenantId,
        workspaceId: form.workspaceId,
        inboundEmailAddress: address,
      },
    });
    if (taken && taken.id !== form.id)
      throw new ConflictException(
        `O endereço já é usado pelo formulário "${taken.name}".`,
      );

    const changed = address !== form.inboundEmailAddress;
    form.inboundEmailAddress = address;
    form.inboundEmail = {
      ...settings,
      kind,
      verifiedAt: changed ? null : settings.verifiedAt,
      pendingTest: changed ? null : settings.pendingTest,
    };
    return this.forms.save(form);
  }

  /** Sends a token by the platform SMTP; the reader marks the address verified on arrival. */
  async sendTest(form: FormEntity) {
    if (!form.inboundEmailAddress)
      throw new BadRequestException('Ative o endereço de e-mail primeiro.');
    if (form.status !== 'active')
      throw new BadRequestException('Publique o formulário antes de testar.');
    const token = randomBytes(6).toString('hex');
    await this.mailer.sendEmail({
      to: form.inboundEmailAddress,
      subject: `Lyra Forms — teste do endereço [${token}]`,
      text: `Teste automático do formulário "${form.name}". Este e-mail não vira lead.`,
      html: `<p>Teste automático do formulário <strong>${escapeHtml(form.name)}</strong>. Este e-mail não vira lead.</p>`,
    });
    form.inboundEmail = {
      ...inboundEmailOf(form),
      pendingTest: { token, sentAt: new Date().toISOString() },
    };
    return this.forms.save(form);
  }

  // ── Reader ───────────────────────────────────────────────────────────────

  @Cron('0 * * * * *', { waitForCompletion: true, name: 'forms-email-reader' })
  async pollAll(): Promise<void> {
    if (process.env.FORMS_EMAIL_READER === 'disabled') return;
    const rows = await this.dataSource.query<
      Array<{ tenant_id: string; workspace_id: string }>
    >(
      `SELECT DISTINCT tenant_id, workspace_id FROM forms
        WHERE inbound_email_address IS NOT NULL AND status = 'active' AND type = 'lead_capture'`,
    );
    for (const row of rows) {
      try {
        await this.pollWorkspace(row.tenant_id, row.workspace_id);
      } catch (error) {
        this.logger.warn(
          `Forms e-mail reader ${row.workspace_id}: ${(error as Error).message}`,
        );
      }
    }
  }

  /** Raw e-mail text is kept for 90 days only (§6.5.6). */
  @Cron('0 30 3 * * *', { name: 'forms-email-retention' })
  async purgeOldText(): Promise<void> {
    await this.dataSource.query(
      `UPDATE form_submissions SET payload = payload - 'text'
        WHERE source = 'email' AND payload ? 'text'
          AND created_at < now() - make_interval(days => $1)`,
      [RETENTION_DAYS],
    );
  }

  async pollWorkspace(tenantId: string, workspaceId: string): Promise<void> {
    if (!(await this.addon.isEnabled(tenantId, workspaceId))) return;
    const credentials = await this.credentials(tenantId, workspaceId);
    if (!credentials) return;

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    const lockKey = `forms_email_reader:${tenantId}:${workspaceId}`;
    try {
      const [{ locked }] = (await runner.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [lockKey],
      )) as Array<{ locked: boolean }>;
      if (!locked) return;
      try {
        await this.readMailbox(tenantId, workspaceId, credentials);
      } finally {
        await runner.query(
          'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
          [lockKey],
        );
      }
    } finally {
      await runner.release();
    }
  }

  private async readMailbox(
    tenantId: string,
    workspaceId: string,
    credentials: ImapCredentials,
  ) {
    const state =
      (await this.syncStates.findOne({ where: { tenantId, workspaceId } })) ??
      this.syncStates.create({
        tenantId,
        workspaceId,
        mailbox: 'INBOX',
        uidValidity: null,
        lastUid: 0,
      });
    state.lastPolledAt = new Date();

    const forms = await this.forms.find({
      where: { tenantId, workspaceId, status: 'active', type: 'lead_capture' },
    });
    const byAddress = new Map(
      forms
        .filter((form) => form.inboundEmailAddress)
        .map((form) => [form.inboundEmailAddress!.toLowerCase(), form]),
    );

    let session: Awaited<ReturnType<FormEmailImapGateway['open']>> | null =
      null;
    let cursor = state.lastUid;
    try {
      session = await this.imap.open(credentials);
      const reset = state.uidValidity !== session.uidValidity;
      const rows = reset
        ? await session.headers({
            uids: (
              await session.searchSince(
                new Date(Date.now() - RESET_WINDOW_DAYS * 86_400_000),
              )
            ).slice(-MAX_MESSAGES_PER_POLL),
          })
        : await session.headers({ after: state.lastUid });
      if (reset) cursor = 0;
      rows.sort((a, b) => a.uid - b.uid);

      for (const row of rows.slice(0, MAX_MESSAGES_PER_POLL)) {
        const { recipients, messageId } = parseRecipientHeaders(row.headers);
        const form = extractAddresses(recipients)
          .map((address) => byAddress.get(address))
          .find(Boolean);
        if (form && row.size <= MAX_SOURCE_BYTES) {
          const dedupId = messageId ?? `uid:${session.uidValidity}:${row.uid}`;
          const seen = await this.submissions.exist({
            where: { formId: form.id, emailMessageId: dedupId },
          });
          if (!seen) {
            const source = await session.source(row.uid);
            if (source)
              await this.handleMessage(form, source, dedupId, credentials.user);
          }
        } else if (form) {
          this.logger.warn(
            `Form ${form.id}: e-mail uid ${row.uid} over ${MAX_SOURCE_BYTES} bytes ignored.`,
          );
        }
        cursor = Math.max(cursor, row.uid);
      }
      if (reset) cursor = Math.max(cursor, session.uidNext - 1);
      state.uidValidity = session.uidValidity;
      state.lastUid = cursor;
      state.lastSuccessAt = new Date();
      state.lastError = null;
    } catch (error) {
      // Progress up to the last handled message is kept; the rest retries next minute.
      if (session) state.uidValidity ??= session.uidValidity;
      state.lastUid = cursor;
      state.lastError = imapErrorMessage(error, credentials.host);
      this.logger.warn(
        `Forms e-mail reader ${workspaceId}: ${state.lastError}`,
      );
    } finally {
      await session?.close().catch(() => undefined);
      await this.syncStates.save(state);
    }
  }

  private async handleMessage(
    form: FormEntity,
    source: Buffer,
    messageId: string,
    mailbox: string,
  ) {
    const parsed = await simpleParser(source, {
      skipImageLinks: true,
      skipTextToHtml: true,
    });
    const html = typeof parsed.html === 'string' ? parsed.html : null;
    const text = parsed.text?.trim() || (html ? htmlToText(html) : '');
    const email = {
      messageId,
      subject: parsed.subject ?? null,
      from: parsed.from?.text ?? null,
      replyTo: parsed.replyTo?.text ?? null,
      date: parsed.date ? parsed.date.toISOString() : null,
      text,
    };
    const settings = inboundEmailOf(form);

    if (
      settings.pendingTest &&
      email.subject?.includes(settings.pendingTest.token)
    ) {
      form.inboundEmail = {
        ...settings,
        verifiedAt: new Date().toISOString(),
        pendingTest: null,
      };
      await this.forms.save(form);
      return;
    }
    const confirmation = detectForwardingConfirmation(email);
    if (confirmation) {
      form.inboundEmail = {
        ...settings,
        forwardingConfirmation: {
          ...confirmation,
          receivedAt: new Date().toISOString(),
        },
      };
      await this.forms.save(form);
      return;
    }
    if (!isSenderAllowed(email.from, settings.allowedSenders)) return;

    const { fields, normalized } = extractEmailLead(
      { ...email, html },
      {
        ownAddresses: [mailbox, form.inboundEmailAddress ?? ''].filter(Boolean),
        fieldMap: validateCapture(form.capture).fieldMap,
      },
    );

    let submission: FormSubmissionEntity;
    try {
      submission = await this.submissions.save(
        this.submissions.create({
          tenantId: form.tenantId,
          workspaceId: form.workspaceId,
          agencyClientId: form.agencyClientId,
          companyContextId: form.companyContextId,
          formId: form.id,
          schemaVersion: form.schemaVersion,
          source: 'email',
          payload: { ...email, text: trimStoredText(text), fields },
          normalized,
          attribution: {},
          clientNonce: null,
          emailMessageId: messageId,
          ipHash: null,
          userAgent: null,
          status: 'received',
          error: null,
          contactId: null,
          opportunityId: null,
          outcome: {},
          processedAt: null,
        }),
      );
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23505'
      )
        return;
      throw error;
    }

    if (settings.aiExtraction && needsAiExtraction(normalized)) {
      const extracted = await this.ai.extract(
        text,
        {
          tenantId: form.tenantId,
          workspaceId: form.workspaceId,
          agencyClientId: form.agencyClientId,
          companyContextId: form.companyContextId,
        },
        submission.id,
      );
      if (
        extracted &&
        (extracted.lead.email || extracted.lead.phone || extracted.lead.name)
      ) {
        const lead = normalized.lead;
        for (const key of Object.keys(lead) as Array<keyof typeof lead>)
          lead[key] ??= extracted.lead[key];
        if (extracted.message && !fields.length)
          normalized.opportunity.notes = extracted.message;
        normalized.extractedBy = 'ai';
        submission.normalized = normalized;
        submission = await this.submissions.save(submission);
      }
    }
    await this.ingestion.process(form, submission);
  }

  private async credentials(
    tenantId: string,
    workspaceId: string,
  ): Promise<ImapCredentials | null> {
    const settings = await this.emailSettings.findOne({
      where: { tenantId, workspaceId },
    });
    if (
      !settings?.imapHost ||
      !settings.imapUser ||
      !settings.imapPasswordEncrypted
    )
      return null;
    const password = this.crypto.decrypt(settings.imapPasswordEncrypted);
    if (!password) return null;
    return {
      host: settings.imapHost,
      port: settings.imapPort ?? 993,
      secure: settings.imapSecure ?? true,
      user: settings.imapUser,
      password,
    };
  }
}

function scopeOf(ctx: RequestContext) {
  if (!ctx.workspaceId)
    throw new BadRequestException('Workspace context is required.');
  return { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId };
}

function validateSenders(input: string[]): string[] {
  if (!Array.isArray(input) || input.length > 50)
    throw new BadRequestException('Informe no máximo 50 remetentes.');
  return [
    ...new Set(
      input
        .map((rule) => String(rule).trim().toLowerCase())
        .filter(Boolean)
        .map((rule) => {
          const ok = rule.startsWith('@')
            ? /^@([a-z0-9-]+\.)+[a-z]{2,}$/.test(rule)
            : isValidAddress(rule);
          if (!ok)
            throw new BadRequestException(
              `"${rule}" não é um e-mail nem um @domínio válido.`,
            );
          return rule;
        }),
    ),
  ];
}

/** IMAP errors carry server text; keep it short and without credentials. */
export function imapErrorMessage(error: unknown, host = ''): string {
  const err = error as {
    authenticationFailed?: boolean;
    code?: string;
    message?: string;
    responseText?: string;
  };
  if (err?.authenticationFailed) {
    // Provider-specific causes the agency can act on (§6.4).
    if (/office365|outlook\.com|hotmail|live\.com/i.test(host))
      return 'O Microsoft 365/Outlook só aceita IMAP com login OAuth, e o leitor usa usuário e senha. Encaminhe os e-mails para uma caixa de outro provedor e configure essa caixa.';
    if (/gmail\.com|googlemail/i.test(host))
      return 'O Google recusou a senha. Use uma senha de app (exige verificação em 2 etapas) e confira se o IMAP está ativado no Gmail.';
    return 'Usuário ou senha IMAP recusados pelo servidor.';
  }
  if (err?.code === 'ENOTFOUND') return 'Servidor IMAP não encontrado.';
  if (err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT')
    return 'Não foi possível conectar ao servidor IMAP (porta/SSL).';
  return (err?.responseText || err?.message || 'Falha no IMAP.').slice(0, 300);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
