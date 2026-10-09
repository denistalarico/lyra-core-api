import { EgressStatus, EncodedFileType } from 'livekit-server-sdk';
import {
  DEFAULT_MEETING_AI_CONFIG,
  type MeetingAiExecution,
} from '../meeting-ai.types';
import { ConfigService } from '@nestjs/config';
import {
  parseMeetingAiResult,
  TeamChatMeetingAiProviderService,
  MEETING_SUMMARY_MODEL,
  MEETING_TRANSCRIPTION_MODEL,
} from './team-chat-meeting-ai-provider.service';

describe('Meeting AI provider contracts (HTTP boundary mocked)', () => {
  const provider = new TeamChatMeetingAiProviderService(new ConfigService());
  const transcript = 'Ana disse: vamos publicar sexta-feira.';
  const result = {
    summary: 'Publicação combinada.',
    topics: ['Publicação'],
    agreements: [
      { text: 'Publicar na sexta.', evidence: 'vamos publicar sexta-feira.' },
    ],
    decisions: [],
    nextSteps: [],
    actionItems: [
      {
        text: 'Publicar conteúdo.',
        evidence: 'vamos publicar sexta-feira.',
        owner: null,
        dueDate: null,
      },
    ],
    openQuestions: [],
  };
  const envelope = (value: unknown = result) => ({
    status: 'completed',
    output: [
      { content: [{ type: 'output_text', text: JSON.stringify(value) }] },
    ],
  });
  afterEach(() => jest.restoreAllMocks());
  it('validates evidence and refuses incomplete responses', () => {
    expect(parseMeetingAiResult(envelope(), transcript)).toEqual(result);
    expect(() =>
      parseMeetingAiResult({ ...envelope(), status: 'incomplete' }, transcript),
    ).toThrow();
    expect(() =>
      parseMeetingAiResult(
        envelope({
          ...result,
          decisions: [{ text: 'Inventada', evidence: 'Nada a ver' }],
        }),
        transcript,
      ),
    ).toThrow(/evidência/);
    expect(() =>
      parseMeetingAiResult(
        envelope({ ...result, topics: [{}] } as never),
        transcript,
      ),
    ).toThrow();
  });
  it('requests structured Responses with storage disabled and no tools', async () => {
    const before = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-only';
    try {
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
          new Response(JSON.stringify(envelope()), {
            headers: { 'x-request-id': 'response-1' },
          }),
      );
      expect((await provider.summarize(transcript)).requestId).toBe(
        'response-1',
      );
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/responses');
      const body = JSON.parse(init!.body as string);
      expect(body).toMatchObject({
        model: MEETING_SUMMARY_MODEL,
        store: false,
        text: { format: { strict: true, type: 'json_schema' } },
      });
      expect(body.tools).toBeUndefined();
      await provider.transcribe(Buffer.from('test audio boundary'));
      const form = fetchMock.mock.calls[1][1]!.body as FormData;
      expect(form.get('model')).toBe(MEETING_TRANSCRIPTION_MODEL);
      expect(form.get('language')).toBe('pt');
    } finally {
      if (before === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = before;
    }
  });
  it('captures mixed MP3 into private storage and recovers accepted Egress without creating another', async () => {
    const config = new ConfigService({
      files: {
        s3: {
          privateBucket: 'private-fixture',
          endpoint: 'https://storage.fixture.test',
          accessKeyId: 'fixture-key',
          secretAccessKey: 'fixture-secret',
          region: 'us-east-1',
        },
      },
    });
    const captureProvider = new TeamChatMeetingAiProviderService(config);
    const client = {
      listEgress: jest.fn().mockResolvedValue([]),
      startRoomCompositeEgress: jest
        .fn()
        .mockResolvedValue({ egressId: 'recording-1' }),
    };
    jest
      .spyOn(captureProvider as never, 'client')
      .mockReturnValue(client as never);
    const execution = {
      audioRef: 'meeting-ai/tenant/workspace/meeting/audio.mp3',
      config: DEFAULT_MEETING_AI_CONFIG,
    } as MeetingAiExecution;
    expect(await captureProvider.capture('room-1', execution)).toBe(
      'recording-1',
    );
    const [roomName, output, options] =
      client.startRoomCompositeEgress.mock.calls[0];
    expect(roomName).toBe('room-1');
    expect(output.fileType).toBe(EncodedFileType.MP3);
    expect(output.filepath).toBe(execution.audioRef);
    expect(output.output.case).toBe('s3');
    expect(output.output.value.bucket).toBe('private-fixture');
    expect(options.audioOnly).toBe(true);
    expect(options.encodingOptions.audioBitrate).toBe(32);
    client.listEgress.mockResolvedValue([
      {
        egressId: 'recording-1',
        request: { filepath: execution.audioRef, timestamp: 1n },
      },
    ]);
    expect(
      await captureProvider.findCapture('room-1', execution.audioRef),
    ).toBe('recording-1');
    expect(await captureProvider.capture('room-1', execution)).toBe(
      'recording-1',
    );
    expect(client.startRoomCompositeEgress).toHaveBeenCalledTimes(1);
  });
  it('uses confirmed Egress termination and nanosecond duration for analysis', async () => {
    const client = {
      listEgress: jest.fn().mockResolvedValue([
        {
          status: EgressStatus.EGRESS_COMPLETE,
          startedAt: 1791547200000000000n,
          endedAt: 1791547202000000000n,
          fileResults: [{ duration: 2000000000n }],
        },
      ]),
    };
    jest.spyOn(provider as never, 'client').mockReturnValue(client as never);
    expect(await provider.recording('recording-1')).toMatchObject({
      complete: true,
      failed: false,
      active: false,
      duration: 2,
      startedAt: '2026-10-09T12:00:00.000Z',
    });
  });
  it('does not return provider error bodies containing sensitive data', async () => {
    const before = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-only';
    try {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response('{"error":"secret transcript"}', { status: 400 }),
        );
      await expect(provider.summarize(transcript)).rejects.toThrow(
        'A OpenAI não concluiu esta etapa.',
      );
    } finally {
      if (before === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = before;
    }
  });
});
