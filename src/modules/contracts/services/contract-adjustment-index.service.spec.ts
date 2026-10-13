import { ContractAdjustmentIndexService } from './contract-adjustment-index.service';
const data = (percent = '1') =>
  Array.from({ length: 14 }, (_, i) => {
    const date = new Date(Date.UTC(2025, 8 + i, 1));
    return {
      data: `01/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`,
      valor: percent,
    };
  });
describe('BCB contract adjustment (offline)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-11-15T12:00:00Z'));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  it('compounds 12 published months and caches for 12 hours', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(data())));
    const service = new ContractAdjustmentIndexService();
    const result = await service.get({ index: 'ipca', until: '2026-10' });
    expect(result).toMatchObject({
      series: 433,
      accumulatedPercent: 12.6825,
      periodStart: '2025-11',
      periodEnd: '2026-10',
    });
    expect(result.months).toHaveLength(12);
    const [url, options] = fetchMock.mock.calls[0];
    expect(
      url instanceof URL ? url.href : typeof url === 'string' ? url : url.url,
    ).toContain('bcdata.sgs.433');
    expect(
      url instanceof URL ? url.href : typeof url === 'string' ? url : url.url,
    ).toContain('dataInicial=01%2F09%2F2025');
    expect(options?.redirect).toBe('error');
    await service.get({ index: 'ipca', until: '2026-10' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('uses actual period when last publication lags and returns negative accumulation', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(data('-0.1').slice(0, -1))),
      );
    expect(
      await new ContractAdjustmentIndexService().get({
        index: 'igpm',
        until: '2026-10',
      }),
    ).toMatchObject({
      series: 189,
      periodEnd: '2026-09',
      accumulatedPercent: -1.1934,
    });
  });
  it('rejects a future month without calling BCB', async () => {
    const mock = jest.spyOn(globalThis, 'fetch');
    await expect(
      new ContractAdjustmentIndexService().get({
        index: 'ipca',
        until: '2026-12',
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'contract_index_not_published' },
    });
    expect(mock).not.toHaveBeenCalled();
  });
  it('distinguishes insufficient publications from an upstream outage', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(data().slice(4))));
    await expect(
      new ContractAdjustmentIndexService().get({
        index: 'ipca',
        until: '2026-10',
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'contract_index_not_published' },
    });
  });
  it.each(['network', 'http', 'duplicate', 'invalid', 'gap'])(
    'returns 503 for %s, leaving manual fallback available',
    async (failure) => {
      const mock = jest.spyOn(globalThis, 'fetch');
      if (failure === 'network') mock.mockRejectedValue(new Error('network'));
      else if (failure === 'http')
        mock.mockResolvedValue(new Response('', { status: 500 }));
      else {
        const values = data();
        if (failure === 'short') values.splice(0, 4);
        if (failure === 'duplicate') values.push(values[0]);
        if (failure === 'invalid') values[0].valor = 'bogus';
        if (failure === 'gap') values.splice(10, 1);
        mock.mockResolvedValue(new Response(JSON.stringify(values)));
      }
      await expect(
        new ContractAdjustmentIndexService().get({
          index: 'ipca',
          until: '2026-10',
        }),
      ).rejects.toMatchObject({
        status: 503,
        response: { code: 'contract_index_unavailable' },
      });
    },
  );
  it('expires the cache', async () => {
    const mock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(data()))),
      );
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const service = new ContractAdjustmentIndexService();
    await service.get({ index: 'ipca', until: '2026-10' });
    clock.mockReturnValue(now + 12 * 60 * 60 * 1000 + 1);
    await service.get({ index: 'ipca', until: '2026-10' });
    expect(mock).toHaveBeenCalledTimes(2);
  });
});
