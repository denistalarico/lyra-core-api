import { createHash } from 'crypto';
import { buildSocialAnalyticsReportHtml } from '../social-analytics-dashboards/services/social-analytics-report.renderer';
import {
  analyticsReportFilename,
  normalizeReportTimezone,
} from './analytics-report.helpers';
import {
  buildAnalyticsReportHtml,
  type ReportRenderInput,
} from './analytics-report.renderer';
import { REPORT_SNAPSHOT_VERSION } from './report-snapshot.contract';

const base: Omit<ReportRenderInput, 'pageMode' | 'orientation'> = {
  title: 'Relatório <mensal> & "aspas"',
  periodSince: '2026-09-01',
  periodUntil: '2026-09-27',
  snapshot: {
    version: REPORT_SNAPSHOT_VERSION,
    width: 1440,
    html: '<div class="agency-shell" data-lyra-product="social"><section data-report-channel="meta_ads">A</section><section data-report-channel="instagram">B</section></div>',
    css: '.social-analytics-card { border-radius: 12px; }',
    rootAttributes: { class: 'font-inter', 'data-theme': 'dark' },
  },
  letterhead: {
    layoutType: 'signature',
    layoutCss: '.doc-header { display: flex; }</style><script>',
    headerHtml:
      '<header class="doc-header"><strong>Agência X</strong></header>',
    footerHtml: '<footer class="doc-footer"><span>Rodapé</span></footer>',
    footerText: 'Agência "X" </style>',
    fontFamily: 'Inter',
    headingFontFamily: 'Sora',
    clientName: 'Padaria <Central>',
    clientLogoUrl: 'data:image/png;base64,AAAA',
  },
};

/**
 * SHA-256 of the HTML `buildSocialAnalyticsReportHtml` produced for `base`
 * before the renderer moved to this module (AN-LF2, RK-AN-2). The Social PDF
 * must not change with the extraction; a new hash here is a visible change to
 * every Social report and needs its own decision.
 */
const SOCIAL_HTML_SHA256 = {
  'paginated:portrait':
    '724c850d3da74f3b60c730873fc1b28b83a9ad1f989313d8817ab812d60b7ac1',
  'paginated:landscape':
    'dce5883b9427c506c92ec37191fe71bd6cad7e45fe02bd51a32f2b52741eb952',
  'continuous:portrait':
    '8a9cbf22a472ed3c32597d16375ea85f685bc2abe237e5a2037806aa69fdd34e',
  'continuous:landscape':
    '9e3bf89feb5f583a6afb53c2a2511814a1ece55abb9fc0536443a0ebd8849b12',
} as const;

describe('buildAnalyticsReportHtml (shared by Social and LeadFlow)', () => {
  it('keeps the Social entry point as the same function', () => {
    expect(buildSocialAnalyticsReportHtml).toBe(buildAnalyticsReportHtml);
  });

  it.each(
    Object.entries(SOCIAL_HTML_SHA256).map(([key, hash]) => {
      const [pageMode, orientation] = key.split(':') as [
        ReportRenderInput['pageMode'],
        ReportRenderInput['orientation'],
      ];
      return [pageMode, orientation, hash] as const;
    }),
  )(
    'renders the Social HTML byte for byte as before (%s, %s)',
    (pageMode, orientation, hash) => {
      const html = buildSocialAnalyticsReportHtml({
        ...base,
        pageMode,
        orientation,
      });

      expect(createHash('sha256').update(html).digest('hex')).toBe(hash);
    },
  );
});

describe('analytics report helpers', () => {
  it('builds an accent-free slug with the period', () => {
    expect(
      analyticsReportFilename('Relatório de Ação', '2026-09-01', '2026-09-30'),
    ).toBe('relatorio-de-acao-2026-09-01-2026-09-30.pdf');
    expect(analyticsReportFilename('***', '2026-09-01', '2026-09-30')).toBe(
      'relatorio-2026-09-01-2026-09-30.pdf',
    );
  });

  it('keeps a valid IANA zone and falls back to UTC otherwise', () => {
    expect(normalizeReportTimezone('America/Sao_Paulo')).toBe(
      'America/Sao_Paulo',
    );
    expect(normalizeReportTimezone('Mars/Olympus')).toBe('UTC');
    expect(normalizeReportTimezone(undefined)).toBe('UTC');
  });
});
