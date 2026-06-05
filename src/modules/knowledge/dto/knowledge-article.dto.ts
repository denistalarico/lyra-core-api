import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from "class-validator";
import {
  AgencyKnowledgeArticleStatus,
  AgencyKnowledgeArticleType,
  AgencyKnowledgeArticleVisibility,
} from "../enums";

export class CreateKnowledgeArticleDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsUUID()
  ownerId?: string | null;

  @IsOptional()
  @IsUUID()
  clientId?: string | null;

  @IsOptional()
  @IsUUID()
  projectId?: string | null;

  @IsOptional()
  @IsUUID()
  taskId?: string | null;

  @IsString()
  @MaxLength(220)
  title!: string;

  @IsString()
  @MaxLength(240)
  slug!: string;

  @IsOptional()
  @IsString()
  summary?: string | null;

  @IsOptional()
  @IsEnum(AgencyKnowledgeArticleType)
  type?: AgencyKnowledgeArticleType;

  @IsOptional()
  @IsEnum(AgencyKnowledgeArticleStatus)
  status?: AgencyKnowledgeArticleStatus;

  @IsOptional()
  @IsEnum(AgencyKnowledgeArticleVisibility)
  visibility?: AgencyKnowledgeArticleVisibility;

  @IsOptional()
  @IsObject()
  headerJson?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  contentJson?: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  contentHtml?: string | null;

  @IsOptional()
  @IsObject()
  footerJson?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsBoolean()
  isOnboardingRequired?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  estimatedReadMinutes?: number;

  @IsOptional()
  @IsString()
  reviewAt?: string | null;
}

export class UpdateKnowledgeArticleDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsUUID()
  ownerId?: string | null;

  @IsOptional()
  @IsUUID()
  clientId?: string | null;

  @IsOptional()
  @IsUUID()
  projectId?: string | null;

  @IsOptional()
  @IsUUID()
  taskId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  slug?: string;

  @IsOptional()
  @IsString()
  summary?: string | null;

  @IsOptional()
  @IsEnum(AgencyKnowledgeArticleType)
  type?: AgencyKnowledgeArticleType;

  @IsOptional()
  @IsEnum(AgencyKnowledgeArticleStatus)
  status?: AgencyKnowledgeArticleStatus;

  @IsOptional()
  @IsEnum(AgencyKnowledgeArticleVisibility)
  visibility?: AgencyKnowledgeArticleVisibility;

  @IsOptional()
  @IsObject()
  headerJson?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  contentJson?: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  contentHtml?: string | null;

  @IsOptional()
  @IsObject()
  footerJson?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsBoolean()
  isOnboardingRequired?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  estimatedReadMinutes?: number;

  @IsOptional()
  @IsString()
  reviewAt?: string | null;
}

export class ListKnowledgeArticlesQueryDto {
  @IsOptional()
  @IsEnum(AgencyKnowledgeArticleStatus)
  status?: AgencyKnowledgeArticleStatus;

  @IsOptional()
  @IsEnum(AgencyKnowledgeArticleType)
  type?: AgencyKnowledgeArticleType;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
