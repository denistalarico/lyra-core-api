import { Injectable } from '@nestjs/common';

const ANALYTICS_DATA_HOST = 'https://analyticsdata.googleapis.com/v1beta';
const REQUEST_TIMEOUT_MS = 20_000;
const PAGE_SIZE = 10_000;
/** Rows read per report before the run is marked `partial` (long-tail guard). */
export const GA4_REPORT_ROW_CAP = 50_000;

export type Ga4DataErrorCode =
  | 'reauth_required'
  | 'permission_denied'
  | 'rate_limited'
  | 'transient'
  | 'bad_request'
  | 'invalid_response';

/**
 * Failure reading the GA4 Data API. `code` is the only thing safe to log or
 * store: provider bodies can echo property and account identifiers.
 */
export class Ga4DataError extends Error {
  constructor(public readonly code: Ga4DataErrorCode) {
    super(code);
    this.name = 'Ga4DataError';
  }
}

export type Ga4ReportRequest = {
  propertyId: string;
  /** `YYYY-MM-DD`, property time zone. */
  startDate: string;
  endDate: string;
  dimensions: string[];
  metrics: string[];
};

export type Ga4ReportRow = { dimensions: string[]; metrics: number[] };

export type Ga4ReportResult = {
  rows: Ga4ReportRow[];
  /** True when the row cap or Google's own aggregation hid part of the data. */
  truncated: boolean;
  apiCalls: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readValue(cell: unknown): string {
  return isRecord(cell) && typeof cell.value === 'string' ? cell.value : '';
}

/**
 * Read-only `runReport` over one property. Authenticated by the caller's OAuth
 * access token only; the token is never logged and provider bodies never leave
 * this class (D-G7, §10.5).
 */
@Injectable()
export class Ga4DataClient {
  async runReport(
    accessToken: string,
    request: Ga4ReportRequest,
  ): Promise<Ga4ReportResult> {
    const rows: Ga4ReportRow[] = [];
    let truncated = false;
    let apiCalls = 0;
    let offset = 0;

    for (;;) {
      const body = await this.post(
        `${ANALYTICS_DATA_HOST}/properties/${encodeURIComponent(request.propertyId)}:runReport`,
        accessToken,
        {
          dateRanges: [
            { startDate: request.startDate, endDate: request.endDate },
          ],
          dimensions: request.dimensions.map((name) => ({ name })),
          metrics: request.metrics.map((name) => ({ name })),
          orderBys: [
            { dimension: { dimensionName: request.dimensions[0] } },
            { metric: { metricName: request.metrics[0] }, desc: true },
          ],
          limit: PAGE_SIZE,
          offset,
          keepEmptyRows: false,
        },
      );
      apiCalls += 1;

      if (!isRecord(body)) throw new Ga4DataError('invalid_response');
      const page = Array.isArray(body.rows) ? body.rows : [];
      for (const row of page) {
        if (!isRecord(row)) continue;
        const dims = Array.isArray(row.dimensionValues)
          ? row.dimensionValues.map(readValue)
          : [];
        const metrics = Array.isArray(row.metricValues)
          ? row.metricValues.map((cell) => Number(readValue(cell)))
          : [];
        if (
          dims.length !== request.dimensions.length ||
          metrics.length !== request.metrics.length
        ) {
          throw new Ga4DataError('invalid_response');
        }
        rows.push({
          dimensions: dims,
          metrics: metrics.map((value) => (Number.isFinite(value) ? value : 0)),
        });
      }

      // Google folds the long tail into "(other)" and says so in metadata.
      if (
        isRecord(body.metadata) &&
        body.metadata.dataLossFromOtherRow === true
      ) {
        truncated = true;
      }

      const total = typeof body.rowCount === 'number' ? body.rowCount : 0;
      offset += page.length;
      if (page.length === 0 || offset >= total) break;
      if (offset >= GA4_REPORT_ROW_CAP) {
        truncated = true;
        break;
      }
    }

    return { rows, truncated, apiCalls };
  }

  private async post(
    url: string,
    accessToken: string,
    json: unknown,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(json),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Ga4DataError('transient');
    }

    if (response.status === 401) throw new Ga4DataError('reauth_required');
    if (response.status === 403) throw new Ga4DataError('permission_denied');
    if (response.status === 429) throw new Ga4DataError('rate_limited');
    if (response.status >= 500) throw new Ga4DataError('transient');
    if (!response.ok) throw new Ga4DataError('bad_request');
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new Ga4DataError('invalid_response');
    }
  }
}
