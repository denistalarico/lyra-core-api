import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class ConfigureFinanceDocumentRecurrenceDto {
  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(1)
  @Max(31)
  generationDay!: number;

  @IsInt()
  @Min(1)
  @Max(31)
  dueDay!: number;

  @IsIn(['current', 'previous'])
  competenceMode!: 'current' | 'previous';

  @IsOptional()
  @IsIn(['draft', 'issued'])
  generateAsStatus?: 'draft' | 'issued';

  @IsOptional()
  @IsUUID()
  contractId?: string | null;
}
