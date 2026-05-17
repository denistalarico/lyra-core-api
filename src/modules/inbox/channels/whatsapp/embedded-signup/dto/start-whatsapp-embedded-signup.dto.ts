import { IsBoolean, IsOptional } from 'class-validator';

export class StartWhatsAppEmbeddedSignupDto {
  @IsOptional()
  @IsBoolean()
  acceptedRules?: boolean;
}
