import { HttpException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContractDefaults } from '../entities/contract-defaults.entity';
import { ContractTargetType } from '../enums';
import {
  contractDefaultsCatalog,
  type ContractDefaultDefinition,
} from '../contract-defaults.catalog';
import { UpdateContractDefaultsDto } from '../dto/update-contract-defaults.dto';
type Scope = { tenantId: string; workspaceId: string; userId?: string | null };
@Injectable()
export class ContractDefaultsService {
  constructor(
    @InjectRepository(ContractDefaults, 'agency')
    private readonly repository: Repository<ContractDefaults>,
  ) {}
  async get(scope: Scope, targetType = 'client') {
    if (targetType !== 'client' && targetType !== 'team_member')
      throw new HttpException({ code: 'contract_target_not_supported' }, 422);
    const row = await this.repository.findOne({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        targetType: targetType as ContractTargetType,
      },
    });
    return this.present(row, targetType);
  }
  async put(scope: Scope, dto: UpdateContractDefaultsDto) {
    if (dto.targetType !== 'client' && dto.targetType !== 'team_member')
      throw new HttpException({ code: 'contract_target_not_supported' }, 422);
    const catalog = contractDefaultsCatalog(dto.targetType);
    const values = this.validateEntries(dto.values, false, catalog);
    const presets = this.validateEntries(dto.presets, true, catalog);
    return this.repository.manager.transaction(async (manager) => {
      // Also serializes first creation: row locks alone cannot lock an absent row.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [
          `contract-defaults:${scope.tenantId}:${scope.workspaceId}:${dto.targetType}`,
        ],
      );
      const repo = manager.getRepository(ContractDefaults);
      const where = {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        targetType: dto.targetType as ContractTargetType,
      };
      const row = await repo.findOne({ where });
      if (
        dto.expectedVersion !== undefined &&
        dto.expectedVersion !== (row?.version ?? 0)
      )
        throw new HttpException(
          { code: 'contract_defaults_version_conflict' },
          409,
        );
      const saved = await repo.save(
        repo.create({
          ...row,
          ...where,
          values,
          presets,
          expiringWindowDays:
            dto.expiringWindowDays ?? row?.expiringWindowDays ?? 30,
          version: (row?.version ?? 0) + 1,
          createdById: row?.createdById ?? scope.userId ?? null,
          updatedById: scope.userId ?? null,
        }),
      );
      return this.present(saved, dto.targetType);
    });
  }
  private validateEntries(
    entries: Record<string, string>,
    preset: boolean,
    catalog: readonly ContractDefaultDefinition[],
  ) {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(entries)) {
      const definition = catalog.find((item) => item.key === key);
      if (!definition || (preset && definition.type !== 'preset'))
        throw new HttpException(
          { code: 'contract_default_key_invalid', key },
          422,
        );
      if (typeof value !== 'string' || value.length > 4000)
        throw new HttpException(
          { code: 'contract_default_value_invalid', key },
          422,
        );
      if (!value.trim()) continue;
      if (preset && value !== 'custom' && !definition.options?.includes(value))
        throw new HttpException(
          { code: 'contract_default_preset_invalid', key },
          422,
        );
      // values hold rendered clauses for presets; custom select text is valid.
      result[key] = value;
    }
    return result;
  }
  private present(
    row: ContractDefaults | null,
    targetType: 'client' | 'team_member',
  ) {
    const catalog = contractDefaultsCatalog(targetType);
    return {
      targetType,
      values: row?.values ?? {},
      presets: row?.presets ?? {},
      expiringWindowDays: row?.expiringWindowDays ?? 30,
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt ?? null,
      updatedById: row?.updatedById ?? null,
      allowedKeys: catalog.map((item) => item.key),
      presetKeys: catalog
        .filter((item) => item.type === 'preset')
        .map((item) => item.key),
    };
  }
}
