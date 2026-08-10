import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';
import { renderTransactionalEmail } from './templates/transactional-email.template';

type NewLoginAlertOptions = {
  to: string;
  userName: string;
  deviceName: string;
  ipAddress: string;
  location: string | null;
  loginAt: Date;
};

type WorkspaceInvitationEmailOptions = {
  to: string;
  workspaceName: string;
  role: string;
  inviteUrl: string;
  expiresInDays: number;
};

type CalendarReminderEmailOptions = {
  to: string;
  eventTitle: string;
  startsAt: Date;
  endsAt: Date;
  description?: string | null;
  meetingUrl?: string | null;
};

export type EmailTransportOverride = {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  fromName?: string | null;
  fromEmail: string;
};

@Injectable()
export class EmailService {
  private readonly defaultTransporter: nodemailer.Transporter;
  private readonly overrideTransporterCache = new Map<
    string,
    nodemailer.Transporter
  >();

  constructor(private configService: ConfigService) {
    this.defaultTransporter = nodemailer.createTransport({
      host: this.configService.get('SMTP_HOST'),
      port: Number(this.configService.get('SMTP_PORT')),
      secure: this.configService.get('SMTP_SECURE') === 'true',
      auth: {
        user: this.configService.get('SMTP_USER'),
        pass: this.configService.get('SMTP_PASS'),
      },
    });
  }

  /**
   * Tenants with their own SMTP configured (workspace email settings) get
   * their transactional emails sent from their own domain; otherwise we fall
   * back to the shared Lyra transporter/sender below.
   */
  private getTransporter(override?: EmailTransportOverride) {
    if (!override) {
      return this.defaultTransporter;
    }

    const cacheKey = `${override.smtpHost}:${override.smtpPort}:${override.smtpUser}`;
    const cached = this.overrideTransporterCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const transporter = nodemailer.createTransport({
      host: override.smtpHost,
      port: override.smtpPort,
      secure: override.smtpSecure,
      auth: {
        user: override.smtpUser,
        pass: override.smtpPassword,
      },
    });

    this.overrideTransporterCache.set(cacheKey, transporter);
    return transporter;
  }

  async sendEmail(options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    override?: EmailTransportOverride;
    attachments?: Array<{
      filename: string;
      content: Buffer | string;
      contentType?: string;
    }>;
  }): Promise<void> {
    if (this.configService.get('EMAIL_DELIVERY_MODE') === 'disabled') {
      return;
    }

    const transporter = this.getTransporter(options.override);
    const fromName =
      options.override?.fromName || this.configService.get('SMTP_FROM_NAME');
    const fromEmail =
      options.override?.fromEmail || this.configService.get('SMTP_FROM_EMAIL');

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments: options.attachments,
    });
  }

  async sendNewLoginAlert(options: NewLoginAlertOptions): Promise<void> {
    if (!options.to) return;

    const loginAt = this.formatLoginDate(options.loginAt);
    const details = [
      ['Dispositivo', options.deviceName],
      ['IP', options.ipAddress],
      ...(options.location ? [['Localizacao', options.location]] : []),
      ['Data e hora', loginAt],
    ];
    const intro = `Olá ${options.userName || 'usuário'}, detectamos um novo login na sua conta Lyra Suite.`;
    const secondaryText = details
      .map(
        ([label, value]) =>
          `<strong>${this.escapeHtml(label)}:</strong> ${this.escapeHtml(value)}`,
      )
      .join('<br />');
    const footerText =
      'Se foi você, nenhuma ação é necessária. Se você não reconhece este login, recomendamos redefinir sua senha imediatamente.';

    const { html } = renderTransactionalEmail({
      title: 'Novo login detectado',
      intro: this.escapeHtml(intro),
      secondaryText,
      footerText,
    });

    const text = [
      'Novo login detectado',
      '',
      intro,
      '',
      ...details.map(([label, value]) => `${label}: ${value}`),
      '',
      footerText,
    ].join('\n');

    await this.sendEmail({
      to: options.to,
      subject: 'Novo login detectado - Lyra Suite',
      html,
      text,
    });
  }

  async sendWorkspaceInvitationEmail(
    options: WorkspaceInvitationEmailOptions,
  ): Promise<void> {
    if (!options.to) return;

    const roleLabel = this.formatInvitationRole(options.role);
    const workspaceName = this.escapeHtml(options.workspaceName);
    const intro = `Você foi convidado(a) para acessar ${workspaceName} no Lyra Suite com permissão de ${this.escapeHtml(roleLabel)}.`;
    const secondaryText = `Este convite expira em ${options.expiresInDays} dias. Se você não esperava este convite, ignore este e-mail.`;

    const { html, text } = renderTransactionalEmail({
      title: 'Convite para o Lyra Suite',
      intro,
      buttonLabel: 'Aceitar convite',
      buttonUrl: options.inviteUrl,
      secondaryText,
      footerText:
        'Este é um e-mail automático de convite da Lyra Suite. O link é pessoal e expira automaticamente.',
    });

    await this.sendEmail({
      to: options.to,
      subject: `Convite para acessar ${options.workspaceName} - Lyra Suite`,
      html,
      text,
    });
  }

  async sendCalendarReminderEmail(
    options: CalendarReminderEmailOptions,
  ): Promise<void> {
    if (!options.to) return;

    const eventTitle = options.eventTitle || 'Evento sem titulo';
    const startsAt = this.formatCalendarDate(options.startsAt);
    const endsAt = this.formatCalendarDate(options.endsAt);
    const description = options.description?.trim();
    const details = [
      `<strong>Inicio:</strong> ${this.escapeHtml(startsAt)}`,
      `<strong>Fim:</strong> ${this.escapeHtml(endsAt)}`,
      ...(description
        ? [`<strong>Descricao:</strong> ${this.escapeHtml(description)}`]
        : []),
      ...(options.meetingUrl
        ? [
            `<strong>Link da reuniao:</strong> <a href="${this.escapeHtml(
              options.meetingUrl,
            )}" style="color:#2563EB;">${this.escapeHtml(options.meetingUrl)}</a>`,
          ]
        : []),
    ];
    const intro = `Lembrete: "${this.escapeHtml(eventTitle)}" esta agendado na sua agenda Lyra.`;
    const secondaryText = details.join('<br />');

    const { html, text } = renderTransactionalEmail({
      title: 'Lembrete de calendario',
      intro,
      buttonLabel: options.meetingUrl ? 'Entrar na reuniao' : undefined,
      buttonUrl: options.meetingUrl ?? undefined,
      secondaryText,
      footerText:
        'Este e um e-mail automatico de lembrete da Lyra Suite. Confira sua agenda para mais detalhes.',
    });

    await this.sendEmail({
      to: options.to,
      subject: `Lembrete: ${eventTitle} - Lyra Suite`,
      html,
      text,
    });
  }

  private formatLoginDate(date: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    }).format(date);
  }

  private formatCalendarDate(date: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    }).format(date);
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatInvitationRole(role: string): string {
    if (role === 'administrator') return 'administrador';
    if (role === 'manager') return 'gestor';
    return 'membro';
  }
}
