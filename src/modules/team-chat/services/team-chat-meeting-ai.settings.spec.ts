import { Repository } from 'typeorm';
import { FilesService } from '../../../common/files/files.service';
import { AgencyMeetingAiSettings } from '../entities/agency-meeting-ai-settings.entity';
import { AgencyMeetingAiSummary } from '../entities';
import { DEFAULT_MEETING_AI_CONFIG } from '../meeting-ai.types';
import { TeamChatMeetingAiProviderService } from './team-chat-meeting-ai-provider.service';
import { TeamChatMeetingAiService } from './team-chat-meeting-ai.service';

describe('TeamChatMeetingAiService settings compatibility', () => {
  it('uses disabled defaults while an older deployment has no settings table', async () => {
    const settings = {
      findOne: jest.fn().mockRejectedValue({
        code: '42P01',
        message: 'relation "agency_meeting_ai_settings" does not exist',
      }),
    };
    const service = new TeamChatMeetingAiService(
      {} as Repository<AgencyMeetingAiSummary>,
      settings as unknown as Repository<AgencyMeetingAiSettings>,
      {} as TeamChatMeetingAiProviderService,
      {} as FilesService,
    );

    await expect(
      service.configuration({ tenantId: 'tenant', workspaceId: 'workspace' }),
    ).resolves.toEqual(DEFAULT_MEETING_AI_CONFIG);
  });

  it('does not hide unrelated database failures', async () => {
    const failure = { code: '42703', message: 'column missing' };
    const settings = { findOne: jest.fn().mockRejectedValue(failure) };
    const service = new TeamChatMeetingAiService(
      {} as Repository<AgencyMeetingAiSummary>,
      settings as unknown as Repository<AgencyMeetingAiSettings>,
      {} as TeamChatMeetingAiProviderService,
      {} as FilesService,
    );

    await expect(
      service.configuration({ tenantId: 'tenant', workspaceId: 'workspace' }),
    ).rejects.toBe(failure);
  });
});
