import { IsIn, IsObject, IsOptional } from 'class-validator';
import type { InboxMessageStatus } from '../entities/inbox-message.entity';

export class PatchInboxMessageDto {
  @IsOptional()
  @IsIn(['draft', 'sent', 'delivered', 'read', 'failed'])
  status?: InboxMessageStatus;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
