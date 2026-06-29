import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuthTokenPayload } from '../auth/types/auth-token-payload.type';
import { UpdateDocumentLayoutDto } from './dto/document-layouts.dto';
import {
  DocumentLayoutEntity,
  DocumentLayoutTemplateEntity,
  DocumentTemplateDocumentType,
  DocumentLayoutType,
} from './entities/document-layout.entities';
import { WorkspaceSettingsCompanyEntity } from '../settings/entities/workspace-settings-company.entity';

const AGENCY_CONNECTION = 'agency';

function firstNonEmpty(...values: Array<string | null | undefined>) {
  return (
    values.find((value) => typeof value === 'string' && value.trim())?.trim() ??
    null
  );
}

export type DocumentLayoutContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
};

@Injectable()
export class DocumentLayoutsService {
  constructor(
    @InjectRepository(DocumentLayoutEntity, AGENCY_CONNECTION)
    private readonly layoutsRepo: Repository<DocumentLayoutEntity>,
    @InjectRepository(DocumentLayoutTemplateEntity, AGENCY_CONNECTION)
    private readonly templatesRepo: Repository<DocumentLayoutTemplateEntity>,
    @InjectRepository(WorkspaceSettingsCompanyEntity)
    private readonly companyRepo: Repository<WorkspaceSettingsCompanyEntity>,
  ) {}

  getContext(
    user: AuthTokenPayload,
    workspaceId?: string,
  ): DocumentLayoutContext {
    return {
      tenantId: user.tenantId,
      workspaceId: workspaceId ?? user.workspaceId,
      userId: user.sub,
    };
  }

  async getDefaultLayout(context: DocumentLayoutContext) {
    const existing = await this.layoutsRepo.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        scope: 'agency',
        isDefault: true,
      },
    });

    if (existing) return this.applyCompanyFallback(existing, context);

    const created = this.layoutsRepo.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      name: 'Layout padrão do Agency',
      scope: 'agency',
      layoutType: 'essence',
      backgroundType: 'white',
      paperFormat: 'a4',
      fontFamily: 'Inter',
      headingFontFamily: 'Sora',
      primaryColor: '#2563EB',
      secondaryColor: '#0F172A',
      textColor: '#0F172A',
      backgroundColor: '#FFFFFF',
      companyName: null,
      companyDocumentLabel: 'CNPJ',
      companyDocumentValue: null,
      slogan: null,
      footerText: 'Documento gerado pelo Lyra Agency.',
      showQrCode: false,
      isDefault: true,
      status: 'active',
      settings: {},
      metadata: {
        source: 'auto_created_default',
      },
    });

    const saved = await this.layoutsRepo.save(created);
    return this.applyCompanyFallback(saved, context);
  }

  private async applyCompanyFallback(
    layout: DocumentLayoutEntity,
    context: DocumentLayoutContext,
  ) {
    const company = await this.companyRepo.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!company) return layout;

    const companyName = firstNonEmpty(
      company.publicName,
      company.legalName,
      company.workspaceName,
    );
    const companyDocumentLabel =
      company.taxIdCustomLabel ||
      (company.taxIdType === 'cnpj'
        ? 'CNPJ'
        : company.taxIdType === 'ein'
          ? 'EIN'
          : 'Documento');
    const companyAddress = [company.addressLine1, company.addressLine2]
      .filter(Boolean)
      .join(', ');

    return this.layoutsRepo.create({
      ...layout,
      logoUrl: firstNonEmpty(
        layout.logoUrl,
        company.logoUrl,
        company.brandLogoUrl,
        company.logoPath ? `/api/assets/${company.logoPath}` : null,
        company.brandLogoAssetKey ? `/api/assets/${company.brandLogoAssetKey}` : null,
      ),
      primaryColor:
        firstNonEmpty(layout.primaryColor, company.primaryColor) ?? '#2563EB',
      secondaryColor:
        firstNonEmpty(layout.secondaryColor, company.secondaryColor) ??
        '#0F172A',
      companyName: firstNonEmpty(layout.companyName, companyName),
      companyDocumentLabel: firstNonEmpty(
        layout.companyDocumentLabel,
        companyDocumentLabel,
      ),
      companyDocumentValue: firstNonEmpty(
        layout.companyDocumentValue,
        company.taxId,
      ),
      companyAddress: firstNonEmpty(layout.companyAddress, companyAddress),
      companyCity: firstNonEmpty(layout.companyCity, company.city),
      companyRegion: firstNonEmpty(layout.companyRegion, company.stateRegion),
      companyPostalCode: firstNonEmpty(
        layout.companyPostalCode,
        company.postalCode,
      ),
      companyCountry: firstNonEmpty(layout.companyCountry, company.country),
      companyPhone: firstNonEmpty(layout.companyPhone, company.phone),
      companyEmail: firstNonEmpty(layout.companyEmail, company.supportEmail),
      companyWebsite: firstNonEmpty(layout.companyWebsite, company.website),
    });
  }

  async updateDefaultLayout(
    context: DocumentLayoutContext,
    dto: UpdateDocumentLayoutDto,
  ) {
    const layout = await this.getDefaultLayout(context);

    const updated = this.layoutsRepo.merge(layout, {
      ...dto,
      settings: {
        ...(layout.settings ?? {}),
        ...(dto.settings ?? {}),
      },
      metadata: {
        ...(layout.metadata ?? {}),
        ...(dto.metadata ?? {}),
      },
    });

    return this.layoutsRepo.save(updated);
  }

  async listTemplates(documentType = 'quote') {
    return this.templatesRepo.find({
      where: {
        documentType: documentType as DocumentTemplateDocumentType,
        isSystem: true,
        status: 'active',
      },
      order: {
        isDefault: 'DESC',
        name: 'ASC',
      },
    });
  }

  async getTemplatePreview(type: DocumentLayoutType) {
    const template = await this.templatesRepo.findOne({
      where: {
        type,
        documentType: 'quote',
        isSystem: true,
        status: 'active',
      },
    });

    return {
      template,
      html: template?.htmlTemplate ?? '',
      css: template?.cssTemplate ?? '',
      previewData: template?.previewData ?? {},
    };
  }

  async getSystemTemplateForType(
    type: DocumentLayoutType,
    documentType: DocumentTemplateDocumentType = 'quote',
  ) {
    const template = await this.templatesRepo.findOne({
      where: {
        type,
        documentType,
        isSystem: true,
        status: 'active',
      },
    });

    if (template) return template;

    return this.templatesRepo.findOne({
      where: {
        type: 'essence',
        documentType,
        isSystem: true,
        status: 'active',
      },
    });
  }
}
