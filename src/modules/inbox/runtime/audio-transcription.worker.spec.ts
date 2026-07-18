import { AudioTranscriptionWorker } from './audio-transcription.worker';

describe('AudioTranscriptionWorker', () => {
  it('does not reclaim terminal failures without a scheduled retry', async () => {
    const query = jest
      .fn<Promise<Array<{ id: string }>>, [string, unknown[]]>()
      .mockResolvedValue([]);
    const dataSource = {
      transaction: jest.fn(
        async (run: (manager: { query: typeof query }) => Promise<unknown>) =>
          run({ query }),
      ),
    };
    const worker = new AudioTranscriptionWorker(
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(worker.processPending(1)).resolves.toBe(0);

    const claimSql = query.mock.calls[0]?.[0];
    expect(claimSql).toBeDefined();
    expect(claimSql).toContain(
      "derivative.status = 'failed' AND derivative.next_attempt_at IS NOT NULL",
    );
    expect(claimSql).not.toContain("derivative.status IN ('pending','failed')");
  });
});
