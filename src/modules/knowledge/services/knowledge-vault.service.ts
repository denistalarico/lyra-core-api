import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CreateKnowledgeVaultItemDto,
  GrantKnowledgeVaultPermissionDto,
  UpdateKnowledgeVaultItemDto,
} from '../dto';
import {
  AgencyKnowledgeVaultAccessLog,
  AgencyKnowledgeVaultItem,
  AgencyKnowledgeVaultPermission,
} from '../entities';
import {
  AgencyKnowledgeVaultAccessAction,
  AgencyKnowledgeVaultPermissionRole,
  AgencyKnowledgeVaultServiceType,
  AgencyKnowledgeVaultStatus,
} from '../enums';
import { KnowledgeVaultCryptoService } from '../crypto/knowledge-vault-crypto.service';
import { KnowledgeContext } from './knowledge-context';

@Injectable()
export class KnowledgeVaultService {
  constructor(
    @InjectRepository(AgencyKnowledgeVaultItem, 'agency')
    private readonly vaultItemsRepository: Repository<AgencyKnowledgeVaultItem>,
    @InjectRepository(AgencyKnowledgeVaultPermission, 'agency')
    private readonly vaultPermissionsRepository: Repository<AgencyKnowledgeVaultPermission>,
    @InjectRepository(AgencyKnowledgeVaultAccessLog, 'agency')
    private readonly vaultAccessLogsRepository: Repository<AgencyKnowledgeVaultAccessLog>,
    private readonly cryptoService: KnowledgeVaultCryptoService,
  ) {}

  list(context: KnowledgeContext) {
    return this.vaultItemsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        status: AgencyKnowledgeVaultStatus.ACTIVE,
      },
      order: {
        updatedAt: 'DESC',
      },
      select: {
        id: true,
        tenantId: true,
        workspaceId: true,
        clientId: true,
        articleId: true,
        title: true,
        description: true,
        serviceType: true,
        serviceUrl: true,
        loginIdentifier: true,
        status: true,
        createdById: true,
        updatedById: true,
        lastRevealedAt: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async create(context: KnowledgeContext, dto: CreateKnowledgeVaultItemDto) {
    const encryptedSecret = this.cryptoService.encrypt(dto.secret);
    const encryptedNotes = dto.secureNotes
      ? this.cryptoService.encrypt(dto.secureNotes)
      : null;

    const item = this.vaultItemsRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      clientId: dto.clientId ?? null,
      articleId: dto.articleId ?? null,
      title: dto.title,
      description: dto.description ?? null,
      serviceType: dto.serviceType ?? AgencyKnowledgeVaultServiceType.OTHER,
      serviceUrl: dto.serviceUrl ?? null,
      loginIdentifier: dto.loginIdentifier ?? null,
      encryptedSecret: encryptedSecret.encryptedValue,
      encryptedNotes: encryptedNotes?.encryptedValue ?? null,
      encryptedNotesIv: encryptedNotes?.iv ?? null,
      encryptedNotesAuthTag: encryptedNotes?.authTag ?? null,
      encryptionIv: encryptedSecret.iv,
      encryptionAuthTag: encryptedSecret.authTag,
      keyVersion: encryptedSecret.keyVersion,
      status: AgencyKnowledgeVaultStatus.ACTIVE,
      createdById: context.userId,
    });

    const saved = await this.vaultItemsRepository.save(item);

    await this.vaultPermissionsRepository.save(
      this.vaultPermissionsRepository.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        vaultItemId: saved.id,
        userId: context.userId,
        role: null,
        canViewMetadata: true,
        canRevealSecret: true,
        canEditSecret: true,
        canManagePermissions: true,
        createdById: context.userId,
      }),
    );

    await this.log(context, saved.id, AgencyKnowledgeVaultAccessAction.CREATED);

    return this.toSafeVaultItem(saved);
  }

  async update(
    context: KnowledgeContext,
    id: string,
    dto: UpdateKnowledgeVaultItemDto,
  ) {
    const item = await this.getRaw(context, id);

    await this.assertCanEdit(context, item.id);

    if (dto.secret) {
      const encryptedSecret = this.cryptoService.encrypt(dto.secret);
      item.encryptedSecret = encryptedSecret.encryptedValue;
      item.encryptionIv = encryptedSecret.iv;
      item.encryptionAuthTag = encryptedSecret.authTag;
      item.keyVersion = encryptedSecret.keyVersion;
    }

    if (dto.secureNotes !== undefined) {
      const encryptedNotes = dto.secureNotes
        ? this.cryptoService.encrypt(dto.secureNotes)
        : null;

      item.encryptedNotes = encryptedNotes?.encryptedValue ?? null;
      item.encryptedNotesIv = encryptedNotes?.iv ?? null;
      item.encryptedNotesAuthTag = encryptedNotes?.authTag ?? null;
    }

    Object.assign(item, {
      clientId: dto.clientId === undefined ? item.clientId : dto.clientId,
      articleId: dto.articleId === undefined ? item.articleId : dto.articleId,
      title: dto.title ?? item.title,
      description:
        dto.description === undefined ? item.description : dto.description,
      serviceType: dto.serviceType ?? item.serviceType,
      serviceUrl:
        dto.serviceUrl === undefined ? item.serviceUrl : dto.serviceUrl,
      loginIdentifier:
        dto.loginIdentifier === undefined
          ? item.loginIdentifier
          : dto.loginIdentifier,
      updatedById: context.userId,
    });

    const saved = await this.vaultItemsRepository.save(item);

    await this.log(context, saved.id, AgencyKnowledgeVaultAccessAction.UPDATED);

    return this.toSafeVaultItem(saved);
  }

  async reveal(context: KnowledgeContext, id: string) {
    const item = await this.getRaw(context, id);
    const canReveal = await this.canReveal(context, item.id);

    if (!canReveal) {
      await this.log(
        context,
        item.id,
        AgencyKnowledgeVaultAccessAction.FAILED_REVEAL_ATTEMPT,
      );

      throw new ForbiddenException(
        'You do not have permission to reveal this secret',
      );
    }

    const secret = this.cryptoService.decrypt(
      item.encryptedSecret,
      item.encryptionIv,
      item.encryptionAuthTag,
    );

    const secureNotes =
      item.encryptedNotes && item.encryptedNotesIv && item.encryptedNotesAuthTag
        ? this.cryptoService.decrypt(
            item.encryptedNotes,
            item.encryptedNotesIv,
            item.encryptedNotesAuthTag,
          )
        : null;

    item.lastRevealedAt = new Date();
    await this.vaultItemsRepository.save(item);

    await this.log(context, item.id, AgencyKnowledgeVaultAccessAction.REVEALED);

    return {
      ...this.toSafeVaultItem(item),
      secret,
      secureNotes,
    };
  }

  async grantPermission(
    context: KnowledgeContext,
    id: string,
    dto: GrantKnowledgeVaultPermissionDto,
  ) {
    await this.getRaw(context, id);
    await this.assertCanManagePermissions(context, id);

    const permission = this.vaultPermissionsRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      vaultItemId: id,
      userId: dto.userId ?? null,
      role: dto.role ?? null,
      canViewMetadata: dto.canViewMetadata ?? true,
      canRevealSecret: dto.canRevealSecret ?? false,
      canEditSecret: dto.canEditSecret ?? false,
      canManagePermissions: dto.canManagePermissions ?? false,
      createdById: context.userId,
    });

    const saved = await this.vaultPermissionsRepository.save(permission);

    await this.log(
      context,
      id,
      AgencyKnowledgeVaultAccessAction.PERMISSION_GRANTED,
    );

    return saved;
  }

  private async getRaw(context: KnowledgeContext, id: string) {
    const item = await this.vaultItemsRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!item) {
      throw new NotFoundException('Knowledge vault item not found');
    }

    return item;
  }

  private async canReveal(context: KnowledgeContext, vaultItemId: string) {
    if (context.role === 'owner' || context.role === 'admin') {
      return true;
    }

    const permission = await this.vaultPermissionsRepository.findOne({
      where: [
        {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          vaultItemId,
          userId: context.userId,
          canRevealSecret: true,
        },
        {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          vaultItemId,
          role: context.role as AgencyKnowledgeVaultPermissionRole,
          canRevealSecret: true,
        },
      ],
    });

    return Boolean(permission);
  }

  private async assertCanEdit(context: KnowledgeContext, vaultItemId: string) {
    if (context.role === 'owner' || context.role === 'admin') {
      return;
    }

    const permission = await this.vaultPermissionsRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        vaultItemId,
        userId: context.userId,
        canEditSecret: true,
      },
    });

    if (!permission) {
      throw new ForbiddenException(
        'You do not have permission to edit this vault item',
      );
    }
  }

  private async assertCanManagePermissions(
    context: KnowledgeContext,
    vaultItemId: string,
  ) {
    if (context.role === 'owner' || context.role === 'admin') {
      return;
    }

    const permission = await this.vaultPermissionsRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        vaultItemId,
        userId: context.userId,
        canManagePermissions: true,
      },
    });

    if (!permission) {
      throw new ForbiddenException(
        'You do not have permission to manage vault permissions',
      );
    }
  }

  async delete(context: KnowledgeContext, id: string) {
    const item = await this.getRaw(context, id);
    await this.assertCanEdit(context, item.id);
    await this.log(context, item.id, AgencyKnowledgeVaultAccessAction.UPDATED);
    await this.vaultItemsRepository.remove(item);
    return { deleted: true, id };
  }

  private async log(
    context: KnowledgeContext,
    vaultItemId: string,
    action: AgencyKnowledgeVaultAccessAction,
  ) {
    await this.vaultAccessLogsRepository.save(
      this.vaultAccessLogsRepository.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        vaultItemId,
        userId: context.userId,
        action,
      }),
    );
  }

  private toSafeVaultItem(item: AgencyKnowledgeVaultItem) {
    const {
      encryptedSecret,
      encryptedNotes,
      encryptedNotesIv,
      encryptedNotesAuthTag,
      encryptionIv,
      encryptionAuthTag,
      ...safe
    } = item;

    return safe;
  }
}
