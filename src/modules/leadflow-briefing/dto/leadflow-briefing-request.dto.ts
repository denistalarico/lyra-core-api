import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { LeadFlowBriefingSourceKind } from '../enums/leadflow-briefing-source-kind.enum';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';

export class CreateBriefingSourceRequestDto {
  @IsUUID()
  settingsId!: string;

  @IsIn(Object.values(LeadFlowSettingsContextType))
  contextType!: LeadFlowSettingsContextType;

  @IsOptional()
  @IsUUID()
  agencyClientId?: string | null;

  @IsIn(Object.values(LeadFlowBriefingSourceKind))
  kind!: LeadFlowBriefingSourceKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(140)
  label!: string;
}

export class IngestBriefingUrlRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  url!: string;
}

export class IngestBriefingPasteRequestDto {
  @IsString()
  @IsNotEmpty()
  text!: string;
}
