import { IsDateString, IsOptional } from 'class-validator';

/** Both dates or neither; the run service enforces the pair and bounded range. */
export class RequestSocialOrganicSyncDto {
  @IsOptional()
  @IsDateString({ strict: true })
  fromDate?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  toDate?: string;
}
