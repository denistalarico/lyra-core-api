import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type {
  DocumentLayoutBackgroundType,
  DocumentLayoutLogoPosition,
  DocumentLayoutPaperFormat,
  DocumentLayoutScope,
  DocumentLayoutType,
} from '../entities/document-layout.entities';

export class UpdateDocumentLayoutDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn([
    'global',
    'agency',
    'sales',
    'quotes',
    'orders',
    'contracts',
    'finance',
    'reports',
  ])
  scope?: DocumentLayoutScope;

  @IsOptional()
  @IsIn(['essence', 'frame', 'authority', 'flow', 'orbit', 'pulse', 'signature'])
  layoutType?: DocumentLayoutType;

  @IsOptional()
  @IsIn(['white', 'soft', 'gradient', 'premium_paper'])
  backgroundType?: DocumentLayoutBackgroundType;

  @IsOptional()
  @IsIn(['a4', 'letter'])
  paperFormat?: DocumentLayoutPaperFormat;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  fontFamily?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  headingFontFamily?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string | null;

  @IsOptional()
  @IsIn(['left', 'center', 'right'])
  logoPosition?: DocumentLayoutLogoPosition;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  logoSize?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  primaryColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  secondaryColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  textColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  backgroundColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  companyName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  companyDocumentLabel?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  companyDocumentValue?: string | null;

  @IsOptional()
  @IsString()
  companyAddress?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  companyCity?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  companyRegion?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  companyPostalCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  companyCountry?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  companyPhone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  companyEmail?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  companyWebsite?: string | null;

  @IsOptional()
  @IsString()
  slogan?: string | null;

  @IsOptional()
  @IsString()
  footerText?: string | null;

  @IsOptional()
  @IsBoolean()
  showQrCode?: boolean;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
