import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
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

  /** F3: capture script selector + field mapping. */
  @IsOptional()
  @IsObject()
  capture?: Record<string, unknown>;
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

  /** Name, e-mail or phone of the lead (case-insensitive, partial). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  /** Inclusive lower bound of `createdAt` (ISO 8601). */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Exclusive upper bound of `createdAt` (ISO 8601). */
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class RemoveFormQueryDto {
  /** Explicit opt-in: deleting a form with submissions deletes them too. */
  @IsOptional()
  @IsIn(['true', 'false'])
  withSubmissions?: 'true' | 'false';
}

export class DeleteFormSubmissionsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids!: string[];
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

/**
 * capture.js posts `payload=<json>` as urlencoded (sendBeacon): a CORS-safelisted
 * type, so any site can send it without a preflight. The JSON is parsed and
 * validated in `form-capture.mapper.ts`.
 */
export class CapturePublicFormDto {
  @IsString()
  @MaxLength(32_000)
  payload!: string;
}

/** F4: address of the form in the agency's IMAP box (§6.2). */
export class UpdateFormInboundEmailDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsIn(['plus', 'alias'])
  kind?: 'plus' | 'alias';

  /** Alias created in hPanel (kind = alias). */
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  address?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(254, { each: true })
  allowedSenders?: string[];

  @IsOptional()
  @IsBoolean()
  aiExtraction?: boolean;
}

/** GL1: settings of the Google Ads lead-form channel (§5.4). */
/** GL2: import earlier leads through this Google Ads connection. */
export class ImportFormGoogleAdsLeadsDto {
  @IsUUID()
  connectionId!: string;
}

export class UpdateFormGoogleAdsLeadsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  sendTestLeadsToCrm?: boolean;
}

/** ML1 (§5.4): `PATCH forms/:id/meta-leads`. `formIds: null` = every form of the Pages. */
export class UpdateFormMetaLeadsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^\d{1,30}$/, { each: true })
  pageIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @Matches(/^\d{1,30}$/, { each: true })
  formIds?: string[] | null;

  @IsOptional()
  @IsBoolean()
  sendTestLeadsToCrm?: boolean;
}

/** ML1: optional form whose exact scope filters the Page picker. */
export class MetaLeadsPagesQueryDto {
  @IsOptional()
  @IsUUID()
  formId?: string;
}
