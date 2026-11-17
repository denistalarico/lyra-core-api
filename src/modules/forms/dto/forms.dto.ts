import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  FORM_STATUSES,
  FORM_SUBMISSION_STATUSES,
  FORM_TYPES,
  type FormStatus,
  type FormSubmissionStatus,
  type FormType,
} from '../forms.types';

/**
 * The jsonb parts (fields, destination, security, …) are typed as objects here
 * and validated field by field in `form-config.validator.ts`.
 */
export class CreateFormDto {
  @IsIn(FORM_TYPES)
  type!: FormType;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsUUID()
  agencyClientId?: string | null;

  @IsOptional()
  @IsUUID()
  companyContextId?: string | null;

  @IsOptional()
  @IsObject()
  fields?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  presentation?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  tracking?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  destination?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  security?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  afterSubmit?: Record<string, unknown>;
}

/** Scope (client/company) and type are fixed at creation. */
export class PatchFormDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsObject()
  fields?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  presentation?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  tracking?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  destination?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  security?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  afterSubmit?: Record<string, unknown>;
}

export class ListFormsQueryDto {
  @IsOptional()
  @IsIn(FORM_STATUSES)
  status?: FormStatus;

  @IsOptional()
  @IsIn(FORM_TYPES)
  type?: FormType;

  @IsOptional()
  @IsUUID()
  agencyClientId?: string;
}

export class ListFormSubmissionsQueryDto {
  @IsOptional()
  @IsIn(FORM_SUBMISSION_STATUSES)
  status?: FormSubmissionStatus;

  @IsOptional()
  @IsNumberString()
  limit?: string;

  @IsOptional()
  @IsNumberString()
  offset?: string;
}

export class SetFormsAddonDto {
  @IsBoolean()
  enabled!: boolean;
}

export class SubmitPublicFormDto {
  @IsObject()
  values!: Record<string, unknown>;

  /** Browser-generated id; a retry with the same nonce never creates a second lead. */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/)
  nonce?: string;

  @IsOptional()
  @IsObject()
  attribution?: Record<string, unknown>;

  /** Honeypot: hidden input that people never fill. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  hp?: string;

  /** Time between render and submit, measured by the page. */
  @IsOptional()
  @IsInt()
  @Min(0)
  elapsedMs?: number;

  @IsOptional()
  @IsIn(['page', 'embed'])
  source?: 'page' | 'embed';
}
