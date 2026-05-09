import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesModule } from '../../common/files/files.module';
import { PublicWebchatController } from './public-webchat.controller';
import { WebchatConversationEntity } from './entities/webchat-conversation.entity';
import { WebchatMessageEntity } from './entities/webchat-message.entity';
import { WebchatVisitorEntity } from './entities/webchat-visitor.entity';
import { WebchatWidgetEntity } from './entities/webchat-widget.entity';
import { WebchatController } from './webchat.controller';
import { WebchatService } from './webchat.service';

@Module({
  imports: [
    FilesModule,
    TypeOrmModule.forFeature([
      WebchatWidgetEntity,
      WebchatVisitorEntity,
      WebchatConversationEntity,
      WebchatMessageEntity,
    ]),
  ],
  controllers: [WebchatController, PublicWebchatController],
  providers: [WebchatService],
  exports: [WebchatService],
})
export class WebchatModule {}
