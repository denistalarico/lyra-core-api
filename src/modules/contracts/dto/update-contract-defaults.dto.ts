import { IsIn, IsInt, IsObject, IsOptional, Max, Min } from 'class-validator';
export class ContractDefaultsQueryDto {
  @IsOptional() @IsIn(['client', 'team_member']) targetType?:
    | 'client'
    | 'team_member';
}
export class UpdateContractDefaultsDto {
  @IsIn(['client', 'team_member']) targetType!: 'client' | 'team_member';
  @IsObject() values!: Record<string, string>;
  @IsObject() presets!: Record<string, string>;
  @IsOptional() @IsInt() @Min(1) @Max(180) expiringWindowDays?: number;
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
}
