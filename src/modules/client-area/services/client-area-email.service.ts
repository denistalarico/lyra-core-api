import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientAreaSettingsEntity } from '../entities/client-area-settings.entity';
import { emailFrontendUrl } from '../../email/email-frontend-url';
import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgencyIdentityCredentialsService } from '../../agency/agency-identity-credentials.service';
import { EmailService } from '../../email/email.service';
import {
  renderTransactionalEmail,
  type TransactionalEmailBrand,
} from '../../email/templates/transactional-email.template';
import type { AgencyUserSecuritySettingsEntity } from '../../agency/entities/agency-auth.entities';
import { ClientAreaManagementService } from './client-area-management.service';
import type { ClientAreaRole } from '../client-area.types';

export const CLIENT_AREA_ROLE_LABELS: Readonly<Record<ClientAreaRole, string>> =
  Object.freeze({
    client_owner: 'Responsável',
    client_member: 'Membro',
    client_admin: 'Administrador',
    client_operator: 'Operador',
    client_viewer: 'Visualizador',
  });

/** The shared renderer interpolates raw HTML; company names are user input. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildClientAreaInvitationUrl(
  baseUrl: string,
  token: string,
  slug?: string,
) {
  return `${baseUrl}/client-area/invitations/${encodeURIComponent(token)}${slug ? `?a=${encodeURIComponent(slug)}` : ''}`;
}

export function buildClientAreaResetUrl(
  baseUrl: string,
  token: string,
  slug?: string,
) {
  return `${baseUrl}/client-area/reset-password?token=${encodeURIComponent(token)}${slug ? `&a=${encodeURIComponent(slug)}` : ''}`;
}

export function renderClientAreaInvitationEmail(input: {
  companyDisplayName: string;
  role: ClientAreaRole;
  url: string;
  expiresAt: Date;
  productName: string;
  brand?: TransactionalEmailBrand;
}) {
  const company = escapeHtml(input.companyDisplayName);
  const expires = input.expiresAt.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  });
  const { html, text } = renderTransactionalEmail({
    title: `Convite para a ${escapeHtml(input.productName)}`,
    intro: `Você foi convidado para acessar <strong>${company}</strong> como ${CLIENT_AREA_ROLE_LABELS[input.role]}.`,
    buttonLabel: 'Aceitar convite',
    buttonUrl: input.url,
    secondaryText: `O convite vale até ${expires}. Se o botão não funcionar, copie este endereço no navegador:<br/>${escapeHtml(input.url)}`,
    footerText:
      'Se você não esperava este convite, ignore este e-mail. Nenhum acesso é criado sem a sua confirmação.',
    brand: input.brand,
  });

  return {
    subject: `Convite para acessar ${input.companyDisplayName}`,
    html,
    text,
  };
}

export function renderClientAreaResetEmail(input: {
  url: string;
  ttlMinutes: number;
  productName: string;
  brand?: TransactionalEmailBrand;
}) {
  const { html, text } = renderTransactionalEmail({
    title: 'Redefinição de senha',
    intro: `Recebemos uma solicitação para redefinir sua senha da ${escapeHtml(input.productName)}.`,
    buttonLabel: 'Redefinir senha',
    buttonUrl: input.url,
    secondaryText: `Este link expira em ${input.ttlMinutes} minutos e só pode ser usado uma vez.`,
    footerText:
      'Se você não solicitou a redefinição, ignore este e-mail: sua senha continua a mesma.',
    brand: input.brand,
  });

  return {
    subject: `Redefinição de senha da ${input.productName}`,
    html,
    text,
  };
}

/**
 * CA2 — transactional emails of the Client Area. Links always point to the
 * Client Area routes of the web app, never to the Agency `/login`.
 * Delivery uses the agency's SMTP override when configured (same as the
 * Agency security emails).
 */
@Injectable()
export class ClientAreaEmailService {
  constructor(
    private readonly emailService: EmailService,
    private readonly credentials: AgencyIdentityCredentialsService,
    private readonly config: ConfigService,
    @InjectRepository(ClientAreaSettingsEntity, 'agency')
    private readonly settingsRepo: Repository<ClientAreaSettingsEntity>,
    @Optional() private readonly management?: ClientAreaManagementService,
  ) {}

  /** Tenant logo when configured; otherwise the template keeps Lyra's. */
  brand(tenantId: string, workspaceId?: string) {
    return this.management?.emailBrand(tenantId, workspaceId);
  }

  async sendTwoFactorCode(
    identity: AgencyUserSecuritySettingsEntity,
    productName: string,
  ) {
    await this.credentials.sendEmailTwoFactorCode(
      identity,
      'login',
      productName,
      await this.brand(identity.tenantId),
    );
  }

  async sendInvitation(input: {
    tenantId: string;
    workspaceId: string;
    to: string;
    token: string;
    companyDisplayName: string;
    role: ClientAreaRole;
    expiresAt: Date;
  }) {
    const settings = await this.settingsRepo.findOne({
      where: { tenantId: input.tenantId, workspaceId: input.workspaceId },
    });
    const email = renderClientAreaInvitationEmail({
      companyDisplayName: input.companyDisplayName,
      role: input.role,
      url: buildClientAreaInvitationUrl(
        this.frontendUrl(),
        input.token,
        settings?.publicSlug,
      ),
      expiresAt: input.expiresAt,
      productName: this.productName(),
      brand: await this.brand(input.tenantId, input.workspaceId),
    });

    await this.emailService.sendEmail({
      to: input.to,
      ...email,
      override: await this.credentials.getEmailTransportOverride(
        input.tenantId,
        input.workspaceId,
      ),
    });
  }

  async sendPasswordReset(input: {
    tenantId: string;
    to: string;
    token: string;
    ttlMinutes: number;
  }) {
    const settings = await this.settingsRepo.findOne({
      where: { tenantId: input.tenantId, enabled: true },
      order: { createdAt: 'ASC' },
    });
    const email = renderClientAreaResetEmail({
      url: buildClientAreaResetUrl(
        this.frontendUrl(),
        input.token,
        settings?.publicSlug,
      ),
      ttlMinutes: input.ttlMinutes,
      productName: this.productName(),
      brand: await this.brand(input.tenantId, settings?.workspaceId),
    });

    await this.emailService.sendEmail({
      to: input.to,
      ...email,
      override: await this.credentials.getEmailTransportOverride(
        input.tenantId,
      ),
    });
  }

  private frontendUrl() {
    return emailFrontendUrl(
      this.config.get<string>('CLIENT_AREA_FRONTEND_URL'),
      this.config.get<string>('AGENCY_FRONTEND_URL'),
      this.config.get<string>('APP_FRONTEND_URL'),
    );
  }

  private productName() {
    return (
      this.config.get<string>('CLIENT_AREA_PRODUCT_NAME') ?? 'Área do Cliente'
    );
  }
}
