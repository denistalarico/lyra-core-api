import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkspaceUserEntity } from '../../modules/settings/entities/workspace-user.entity';
import { AccessControlService } from './access-control.service';

@Module({
  imports: [TypeOrmModule.forFeature([WorkspaceUserEntity])],
  providers: [AccessControlService],
  exports: [AccessControlService],
})
export class AccessControlModule {}
