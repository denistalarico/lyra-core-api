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

const AGENCY_CONNECTION = 'agency';

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

    if (existing) return existing;

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

    return this.layoutsRepo.save(created);
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
