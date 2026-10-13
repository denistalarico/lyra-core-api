import { HttpException, Injectable, Logger } from '@nestjs/common';
import { contractToday } from '../contract-term';
import { ContractAdjustmentIndexQueryDto } from '../dto/contract-adjustment-index-query.dto';
export type ContractAdjustmentIndex = {
  index: 'ipca' | 'igpm';
  source: 'bcb_sgs';
  series: 433 | 189;
  months: { month: string; percent: number }[];
  accumulatedPercent: number;
  periodStart: string;
  periodEnd: string;
};
@Injectable()
export class ContractAdjustmentIndexService {
  private readonly logger = new Logger(ContractAdjustmentIndexService.name);
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: ContractAdjustmentIndex }
  >();
  async get(
    query: ContractAdjustmentIndexQueryDto,
  ): Promise<ContractAdjustmentIndex> {
    if (query.until > contractToday().slice(0, 7)) {
      throw new HttpException({ code: 'contract_index_not_published' }, 422);
    }
    const series = query.index === 'ipca' ? 433 : 189;
    const key = `${series}:${query.until}`,
      cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const [year, month] = query.until.split('-').map(Number);
    const start = new Date(Date.UTC(year, month - 14, 1)),
      end = new Date(Date.UTC(year, month, 0));
    const format = (date: Date) =>
      `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
    try {
      const url = new URL(
        `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${series}/dados`,
      );
      url.search = new URLSearchParams({
        formato: 'json',
        dataInicial: format(start),
        dataFinal: format(end),
      }).toString();
      const response = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`BCB HTTP ${response.status}`);
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new Error('Invalid BCB response');
      const monthly = new Map<string, number>();
      for (const item of data as unknown[]) {
        if (!item || typeof item !== 'object')
          throw new Error('Invalid BCB response');
        const { data: date, valor } = item as { data: unknown; valor: unknown };
        if (
          typeof date !== 'string' ||
          !/^\d{2}\/\d{2}\/\d{4}$/.test(date) ||
          typeof valor !== 'string' ||
          !/^-?\d+(?:[.,]\d+)?$/.test(valor)
        )
          throw new Error('Invalid BCB response');
        const parts = date.split('/');
        const m = `${parts[2]}-${parts[1]}`,
          percent = Number(valor.replace(',', '.'));
        if (m > query.until || m < start.toISOString().slice(0, 7)) continue;
        if (!Number.isFinite(percent) || percent <= -100 || monthly.has(m))
          throw new Error('Invalid BCB response');
        monthly.set(m, percent);
      }
      const months = [...monthly]
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-12)
        .map(([month, percent]) => ({ month, percent }));
      if (months.length !== 12)
        throw new HttpException({ code: 'contract_index_not_published' }, 422);
      // A missing publication within the selected period must not silently turn
      // a 12-month adjustment into a 13-month one.
      for (let i = 1; i < months.length; i++) {
        const prior = new Date(`${months[i - 1].month}-01T00:00:00Z`);
        prior.setUTCMonth(prior.getUTCMonth() + 1);
        if (prior.toISOString().slice(0, 7) !== months[i].month)
          throw new Error('BCB publication gap');
      }
      const accumulatedPercent = Number(
        (
          (months.reduce(
            (product, item) => product * (1 + item.percent / 100),
            1,
          ) -
            1) *
          100
        ).toFixed(4),
      );
      if (!Number.isFinite(accumulatedPercent))
        throw new Error('Invalid BCB response');
      const value: ContractAdjustmentIndex = {
        index: query.index,
        source: 'bcb_sgs',
        series,
        months,
        accumulatedPercent,
        periodStart: months[0].month,
        periodEnd: months[11].month,
      };
      for (const [cacheKey, entry] of this.cache)
        if (entry.expiresAt <= Date.now()) this.cache.delete(cacheKey);
      if (this.cache.size >= 500) {
        const oldest = this.cache.keys().next();
        if (!oldest.done) this.cache.delete(oldest.value);
      }
      this.cache.set(key, {
        expiresAt: Date.now() + 12 * 60 * 60 * 1000,
        value,
      });
      return value;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(
        `BCB index ${query.index} until ${query.until} failed: ${error instanceof Error ? error.message : 'invalid response'}`,
      );
      throw new HttpException({ code: 'contract_index_unavailable' }, 503);
    }
  }
}
