import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions';
import { EmailService } from './email.service';
import { EmailTestController } from './email-test.controller';

@Module({
  imports: [PermissionsModule],
  controllers: [EmailTestController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
