import { IsIn, IsInt, IsObject, IsOptional, Max, Min } from 'class-validator';
export class ContractDefaultsQueryDto {
  @IsOptional() @IsIn(['client']) targetType?: 'client';
}
export class UpdateContractDefaultsDto {
  @IsIn(['client']) targetType!: 'client';
  @IsObject() values!: Record<string, string>;
  @IsObject() presets!: Record<string, string>;
  @IsOptional() @IsInt() @Min(1) @Max(180) expiringWindowDays?: number;
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
}
