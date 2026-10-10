import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { AgencyKnowledgeAuthorDisplayMode } from '../enums';

/**
 * Body of a new mural/personal note. Before SEC-A1 this was an unvalidated
 * inline type and the browser sent `authorName` (the UI sent "Eu"); authorship
 * is now resolved server-side and any author field is rejected.
 */
export class CreateKnowledgeQuickNoteDto {
  @IsString()
  @MaxLength(220)
  title!: string;

  @IsOptional()
  @IsString()
  body?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsNumber()
  positionX?: number;

  @IsOptional()
  @IsNumber()
  positionY?: number;

  /**
   * The only authorship input the browser controls (SEC-A1): which label to
   * show. Name and job title are resolved by the backend.
   */
  @IsOptional()
  @IsEnum(AgencyKnowledgeAuthorDisplayMode)
  authorDisplayMode?: AgencyKnowledgeAuthorDisplayMode;
}
