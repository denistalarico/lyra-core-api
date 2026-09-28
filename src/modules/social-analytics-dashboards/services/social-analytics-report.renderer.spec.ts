import {
  parseReportSnapshot,
  ReportSnapshotError,
  REPORT_SNAPSHOT_VERSION,
  type ReportSnapshot,
} from '../report-snapshot.contract';
import {
  buildSocialAnalyticsReportHtml,
  reportZoom,
  type ReportLetterhead,
  type ReportRenderInput,
} from './social-analytics-report.renderer';
import { isAllowedReportRequest } from './social-analytics-report.service';

const snapshot: ReportSnapshot = {
  version: REPORT_SNAPSHOT_VERSION,
  width: 1200,
  html: '<div class="agency-shell" data-lyra-product="social"><section data-report-channel="instagram">Cards</section><section data-report-channel="facebook">Mais cards</section></div>',
  css: '.social-analytics-card { border-radius: 12px; }',
  rootAttributes: { class: 'font-inter', 'data-theme': 'dark' },
};

const letterhead: ReportLetterhead = {
  layoutType: 'pulse',
  layoutCss: '.doc-header { display: flex; }',
  headerHtml: '<header class="doc-header"><strong>Agência X</strong></header>',
  footerHtml: '<footer class="doc-footer"><span>Rodapé</span></footer>',
  footerText: 'Agência "X" </style>',
  fontFamily: 'Inter',
  headingFontFamily: 'Sora',
  clientName: 'Padaria <Central>',
  clientLogoUrl: null,
};

function render(overrides: Partial<ReportRenderInput> = {}): string {
  return buildSocialAnalyticsReportHtml({
    title: 'Relatório mensal',
    periodSince: '2026-09-01',
    periodUntil: '2026-09-27',
    pageMode: 'paginated',
    orientation: 'landscape',
    snapshot,
    letterhead,
    ...overrides,
  });
}

describe('buildSocialAnalyticsReportHtml', () => {
  it('opens with the model header, then the client company and the title', () => {
    const html = render();

    const header = html.indexOf('class="doc-header"');
    const client = html.indexOf('Padaria &lt;Central&gt;');
    const title = html.indexOf('<h1>Relatório mensal</h1>');
    const body = html.indexOf('data-report-channel="instagram"');

    expect(header).toBeGreaterThan(0);
    expect(client).toBeGreaterThan(header);
    expect(title).toBeGreaterThan(client);
    expect(body).toBeGreaterThan(title);
    expect(html).toContain('01/09/2026 a 27/09/2026');
  });

  it('uses the agency model class and falls back to essence for an unknown one', () => {
    expect(render()).toContain('doc-template-pulse report-page');
    expect(
      render({ letterhead: { ...letterhead, layoutType: 'bogus' } }),
    ).toContain('doc-template-essence report-page');
  });

  it('always prints in the light theme', () => {
    const html = render();

    expect(html).toContain('data-theme="light"');
    expect(html).not.toContain('data-theme="dark"');
    expect(html).toContain('class="font-inter"');
  });

  it('declares page margins and a footer with the page count on every sheet', () => {
    const html = render();

    expect(html).toContain('size: A4 landscape;');
    expect(html).toMatch(/margin: 12mm 12mm 16mm;/);
    expect(html).toContain('counter(page)');
    expect(html).toContain('counter(pages)');
    // The footer text is a CSS string: quotes escaped, and `<` cannot close
    // the style element.
    expect(html).toContain('content: "Agência \\"X\\" \\3C /style>"');
  });

  it('breaks pages between channels only in the paginated mode', () => {
    expect(render()).toContain('break-before: page');
    expect(render({ pageMode: 'continuous' })).not.toContain(
      'break-before: page',
    );
  });

  it('keeps the on-screen width and zooms it to the printable width', () => {
    const html = render();

    expect(html).toContain(
      `width: 1200px; zoom: ${reportZoom(1200, 'landscape')};`,
    );
    expect(reportZoom(1200, 'landscape')).toBeCloseTo(1031.81 / 1200, 3);
    expect(reportZoom(1200, 'portrait')).toBeCloseTo(702.99 / 1200, 3);
    // A narrow dashboard is not enlarged.
    expect(reportZoom(400, 'portrait')).toBe(1);
  });

  it('shows the client logo only when there is one', () => {
    expect(render()).not.toContain('<img class="report-title__logo"');
    expect(
      render({
        letterhead: {
          ...letterhead,
          clientLogoUrl: 'data:image/png;base64,AA',
        },
      }),
    ).toContain(
      '<img class="report-title__logo" src="data:image/png;base64,AA"',
    );
  });
});

describe('parseReportSnapshot', () => {
  const raw = (overrides: Record<string, unknown> = {}) => ({
    version: 2,
    width: 1200,
    html: '<section data-report-channel="instagram">x</section>',
    css: '.a{}',
    rootAttributes: { 'data-lyra-product': 'social' },
    ...overrides,
  });

  it('accepts what the dashboard sends', () => {
    expect(parseReportSnapshot(raw()).width).toBe(1200);
  });

  it('refuses an older body, a bad width and empty content', () => {
    for (const overrides of [
      { version: 1 },
      { width: 100 },
      { width: 99_999 },
      { width: '1200' },
      { html: '   ' },
    ]) {
      expect(() => parseReportSnapshot(raw(overrides))).toThrow(
        ReportSnapshotError,
      );
    }
  });

  it('refuses markup that only exists to run or embed something', () => {
    for (const html of [
      '<script>alert(1)</script>',
      '<IFRAME src="x">',
      '<link rel="stylesheet" href="http://10.0.0.1/x.css">',
      '<base href="http://internal/">',
      '<meta http-equiv="refresh" content="0">',
    ]) {
      expect(() => parseReportSnapshot(raw({ html }))).toThrow(
        ReportSnapshotError,
      );
    }
  });

  it('does not mistake escaped text for markup', () => {
    expect(() =>
      parseReportSnapshot(raw({ html: '<p>&lt;script&gt; no título</p>' })),
    ).not.toThrow();
  });

  it('refuses CSS that closes the style element and unsafe root attributes', () => {
    expect(() => parseReportSnapshot(raw({ css: '</style><p>x</p>' }))).toThrow(
      ReportSnapshotError,
    );
    expect(() =>
      parseReportSnapshot(raw({ rootAttributes: { onload: 'x' } })),
    ).toThrow(ReportSnapshotError);
  });
});

describe('isAllowedReportRequest', () => {
  const logo = 'https://api.lyra.test/api/assets/logo.png';

  it('allows the agency logo exactly and Meta thumbnails over HTTPS', () => {
    expect(isAllowedReportRequest(logo, logo)).toBe(true);
    expect(
      isAllowedReportRequest('https://scontent.xx.fbcdn.net/v/t1.jpg', logo),
    ).toBe(true);
    expect(
      isAllowedReportRequest('https://scontent.cdninstagram.com/a.jpg', logo),
    ).toBe(true);
  });

  it('refuses everything else', () => {
    for (const url of [
      'http://scontent.xx.fbcdn.net/v/t1.jpg',
      'https://fbcdn.net.evil.test/a.jpg',
      'http://127.0.0.1:3000/api/admin',
      'http://169.254.169.254/latest/meta-data',
      'https://api.lyra.test/api/assets/other.png',
      'file:///etc/passwd',
      'not a url',
    ]) {
      expect(isAllowedReportRequest(url, logo)).toBe(false);
    }
  });
});
