import {
  IsBooleanString,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';
import { LeadFlowSettingsStatus } from '../enums/leadflow-settings-status.enum';

export class ListLeadFlowClientsQueryDto {
  @IsOptional()
  @IsBooleanString()
  configured?: string;

  @IsOptional()
  @IsEnum(LeadFlowSettingsStatus)
  status?: LeadFlowSettingsStatus;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;

  @IsOptional()
  @IsNumberString()
  offset?: string;
}
