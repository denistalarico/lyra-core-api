import { Body, Controller, Param, Post } from '@nestjs/common';
import { JoinPublicTeamChatMeetingDto } from '../dto';
import { TeamChatMeetingsService } from '../services/team-chat-meetings.service';

/** This surface issues guest tokens only. It exposes no summary or private file. */
@Controller('public/agency/team-chat/meetings')
export class TeamChatPublicMeetingsController {
  constructor(private readonly meetings: TeamChatMeetingsService) {}
  @Post(':publicSlug/join')
  join(
    @Param('publicSlug') slug: string,
    @Body() dto: JoinPublicTeamChatMeetingDto,
  ) {
    return this.meetings.joinPublic(slug, dto);
  }
}
