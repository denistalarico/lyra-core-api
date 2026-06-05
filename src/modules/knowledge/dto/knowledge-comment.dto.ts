import { IsEnum, IsOptional, IsString } from "class-validator";
import { AgencyKnowledgeCommentStatus } from "../enums";

export class CreateKnowledgeCommentDto {
  @IsString()
  body!: string;
}

export class UpdateKnowledgeCommentDto {
  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsEnum(AgencyKnowledgeCommentStatus)
  status?: AgencyKnowledgeCommentStatus;
}
