import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import type { AgencyClientCompanyContextStatus } from '../entities/agency-client-company-context.entity';

export class CreateAgencyClientCompanyContextDto {
  @IsUUID()
  companyContactId!: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateAgencyClientCompanyContextDto {
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: Exclude<AgencyClientCompanyContextStatus, 'archived'>;
}
