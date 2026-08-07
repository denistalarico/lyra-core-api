import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
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

/**
 * The reviewer's edited text for one field. Only strings are accepted: every
 * path in the extraction catalog is a free-text draft field, so a non-string
 * here could only come from a malformed client.
 */
export class ApplyBriefingSuggestionRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  value?: string;
}

export class ConfirmBriefingSuggestionItemDto {
  @IsUUID()
  suggestionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  value?: string;
}

export class ConfirmBriefingSuggestionsRequestDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => ConfirmBriefingSuggestionItemDto)
  items!: ConfirmBriefingSuggestionItemDto[];
}
