import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FilesService } from '../../../common/files/files.service';
import { UserProfileEntity } from '../../settings/entities/user-profile.entity';
import type { ClientAreaIdentity } from '../client-area.types';
import type { PatchClientAreaProfileDto } from '../dto/client-area-profile.dto';

@Injectable()
export class ClientAreaProfileService {
  constructor(
    @InjectRepository(UserProfileEntity, 'agency')
    private readonly profiles: Repository<UserProfileEntity>,
    private readonly files: FilesService,
  ) {}

  async get(identity: ClientAreaIdentity) {
    const row = await this.profiles.findOne({
      where: { tenantId: identity.tenantId, userId: identity.userId },
    });
    return this.project(identity, row);
  }

  async patch(identity: ClientAreaIdentity, dto: PatchClientAreaProfileDto) {
    const patch = {
      tenantId: identity.tenantId,
      userId: identity.userId,
      ...(dto.displayName !== undefined
        ? { displayName: dto.displayName.trim() }
        : {}),
      ...(dto.jobTitle !== undefined
        ? { jobTitle: dto.jobTitle?.trim() || null }
        : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
    };
    await this.profiles.upsert(patch, ['tenantId', 'userId']);
    return this.get(identity);
  }

  async uploadAvatar(identity: ClientAreaIdentity, file: Express.Multer.File) {
    const stored = await this.files.uploadImageAsset({
      file,
      path: `tenants/${identity.tenantId}/users/${identity.userId}/avatar-${Date.now()}.webp`,
      maxDimension: 512,
    });
    await this.profiles.upsert(
      {
        tenantId: identity.tenantId,
        userId: identity.userId,
        avatarUrl: stored.url,
        avatarAssetKey: stored.path,
      },
      ['tenantId', 'userId'],
    );
    return this.get(identity);
  }

  async removeAvatar(identity: ClientAreaIdentity) {
    await this.profiles.update(
      { tenantId: identity.tenantId, userId: identity.userId },
      { avatarUrl: null, avatarPath: null, avatarAssetKey: null },
    );
    return this.get(identity);
  }

  async readAvatar(identity: ClientAreaIdentity) {
    const row = await this.profiles.findOne({
      select: { avatarAssetKey: true },
      where: { tenantId: identity.tenantId, userId: identity.userId },
    });
    if (!row?.avatarAssetKey) throw new NotFoundException('Avatar not found.');
    return this.files.getAsset(row.avatarAssetKey);
  }

  private project(identity: ClientAreaIdentity, row: UserProfileEntity | null) {
    return {
      displayName: row?.displayName?.trim() || identity.email,
      jobTitle: row?.jobTitle ?? null,
      phone: row?.phone ?? null,
      email: identity.email,
      avatarUrl: row?.avatarAssetKey
        ? `/client-area/me/profile/avatar?v=${row.updatedAt?.getTime() ?? Date.now()}`
        : null,
    };
  }
}
