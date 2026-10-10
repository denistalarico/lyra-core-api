import { IsEnum, IsOptional, IsString } from "class-validator";
import {
  AgencyKnowledgeAuthorDisplayMode,
  AgencyKnowledgeCommentStatus,
} from "../enums";

export class CreateKnowledgeCommentDto {
  @IsString()
  body!: string;

  /**
   * The only authorship input the browser controls (SEC-A1): which label to
   * show. Name and job title are resolved by the backend.
   */
  @IsOptional()
  @IsEnum(AgencyKnowledgeAuthorDisplayMode)
  authorDisplayMode?: AgencyKnowledgeAuthorDisplayMode;
}

export class UpdateKnowledgeCommentDto {
  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsEnum(AgencyKnowledgeCommentStatus)
  status?: AgencyKnowledgeCommentStatus;
}
