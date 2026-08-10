import { chromium, type Browser, type Page } from 'playwright';
import {
  leadFlowBetaRoutes,
  resolveLeadFlowBetaTarget,
  socketIoUrl,
} from './leadflow-beta-target';

const run = process.env.LEADFLOW_BETA_E2E === 'true' ? describe : describe.skip;

jest.setTimeout(180_000);

run('LeadFlow beta authenticated development smoke (Playwright)', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('loads the API, Socket.IO and every beta surface without chunk/runtime failures', async () => {
    const target = resolveLeadFlowBetaTarget(process.env);
    const context = await browser.newContext({
      baseURL: target.agencyUrl,
      locale: 'pt-BR',
    });
    const page = await context.newPage();
    const failures: string[] = [];
    attachFailureCollectors(page, failures);

    const health = await context.request.get(`${target.apiUrl}/health`);
    expect(health.status()).toBeLessThan(500);
    expect(health.ok()).toBe(true);

    const socketHandshake = await context.request.get(
      socketIoUrl(target.apiUrl),
      {
        headers: { Origin: target.agencyUrl },
      },
    );
    expect(socketHandshake.status()).toBe(200);
    expect((await socketHandshake.text()).startsWith('0{')).toBe(true);

    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(target.email);
    await page.locator('input[type="password"]').fill(target.password);
    await page.locator('button[type="submit"]').click();

    const otpInput = page.locator('input[autocomplete="one-time-code"]');
    if (await otpInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      if (!target.otp) throw new Error('leadflow_beta_otp_missing');
      await otpInput.fill(target.otp);
      await page.locator('button[type="submit"]').click();
    }
    await page.waitForURL((url) => url.pathname !== '/login', {
      timeout: 30_000,
    });

    for (const route of leadFlowBetaRoutes(target)) {
      failures.length = 0;
      const response = await page.goto(route, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      if (!response) throw new Error(`navigation_response_missing:${route}`);
      if (response.status() >= 500) {
        throw new Error(`navigation_status_${response.status()}:${route}`);
      }
      if (new URL(page.url()).pathname !== route) {
        throw new Error(`unexpected_redirect:${route}:${page.url()}`);
      }
      await page.locator('h1').first().waitFor({
        state: 'visible',
        timeout: 20_000,
      });
      await page.waitForTimeout(750);
      if (failures.length) {
        throw new Error(`runtime_failures:${route}\n${failures.join('\n')}`);
      }
    }

    await context.close();
  });
});

function attachFailureCollectors(page: Page, failures: string[]) {
  page.on('pageerror', (error) => {
    failures.push(`pageerror: ${error.message}`);
  });
  page.on('requestfailed', (request) => {
    if (['document', 'script'].includes(request.resourceType())) {
      failures.push(
        `requestfailed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`,
      );
    }
  });
  page.on('response', (response) => {
    if (
      response.status() >= 500 &&
      ['document', 'script', 'xhr', 'fetch'].includes(
        response.request().resourceType(),
      )
    ) {
      failures.push(`response ${response.status()}: ${response.url()}`);
    }
  });
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /(ChunkLoadError|Failed to load chunk|WebSocket connection.*failed)/i.test(
        message.text(),
      )
    ) {
      failures.push(`console: ${message.text()}`);
    }
  });
  page.on('websocket', (socket) => {
    socket.on('socketerror', (error) => {
      failures.push(`websocket: ${error}`);
    });
  });
}
