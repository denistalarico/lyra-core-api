import { IsIn, Matches } from 'class-validator';
export class ContractAdjustmentIndexQueryDto {
  @IsIn(['ipca', 'igpm']) index!: 'ipca' | 'igpm';
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) until!: string;
}
