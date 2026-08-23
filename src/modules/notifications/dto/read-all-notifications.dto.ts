import { IsEnum, IsOptional, IsString } from 'class-validator';
import { NotificationProductKey } from '../enums';

export class ReadAllNotificationsDto {
  @IsOptional()
  @IsEnum(NotificationProductKey)
  productKey?: NotificationProductKey;

  @IsOptional()
  @IsString()
  moduleKey?: string;

  @IsOptional()
  @IsString()
  excludeModuleKey?: string;
}
