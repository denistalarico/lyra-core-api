import { RoomServiceClient } from 'livekit-server-sdk';
import { TeamChatLiveKitProviderService } from './team-chat-livekit-provider.service';

jest.mock('livekit-server-sdk', () => ({
  RoomServiceClient: jest.fn(),
  AccessToken: jest.fn(),
}));

describe('LiveKit meeting presence', () => {
  const previous = { ...process.env };
  const client = { listRooms: jest.fn(), listParticipants: jest.fn() };
  const provider = new TeamChatLiveKitProviderService();
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.LIVEKIT_URL = 'ws://localhost:7880';
    process.env.LIVEKIT_API_KEY = 'test-key';
    process.env.LIVEKIT_API_SECRET = 'test-secret';
    (RoomServiceClient as jest.Mock).mockReturnValue(client);
  });
  afterAll(() => {
    process.env = previous;
  });

  it('counts connected listeners even when the room aggregate reports zero', async () => {
    client.listRooms.mockResolvedValue([
      { name: 'meeting', numParticipants: 0 },
    ]);
    client.listParticipants.mockResolvedValue([
      { identity: 'user:muted', permission: { hidden: false } },
      { identity: 'guest:muted' },
      { identity: 'recorder', permission: { recorder: true } },
      { identity: 'agent', permission: { agent: true } },
      { identity: 'hidden', permission: { hidden: true } },
    ]);
    expect(await provider.roomOccupancy(['meeting'])).toEqual(
      new Map([['meeting', 2]]),
    );
    expect(client.listParticipants).toHaveBeenCalledWith('meeting');
  });

  it('does not turn a participant API outage into an empty room', async () => {
    client.listRooms.mockResolvedValue([{ name: 'meeting' }]);
    client.listParticipants.mockRejectedValue(new Error('unavailable'));
    await expect(provider.roomOccupancy(['meeting'])).rejects.toThrow(
      'unavailable',
    );
  });

  it('distinguishes an absent room from unavailable provider configuration', async () => {
    client.listRooms.mockResolvedValue([]);
    expect(await provider.roomOccupancy(['absent'])).toEqual(new Map());
    delete process.env.LIVEKIT_API_SECRET;
    expect(await provider.roomOccupancy(['absent'])).toBeNull();
  });
});
