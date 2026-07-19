import { IsOptional, IsUUID } from 'class-validator';

export class ReconcileDefaultBindingDto {
  @IsOptional()
  @IsUUID()
  channelId?: string;

  @IsOptional()
  @IsUUID()
  defaultAgentId?: string;
}
