import { Browser, chromium, Page } from 'playwright';

describe('LeadFlow Inbox assisted mode visual contract', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => browser.close());
  beforeEach(async () => {
    page = await browser.newPage();
    await page.route('https://inbox.test/**', async (route) => {
      const workspace = route.request().headers()['x-workspace-id'];
      if (workspace !== 'workspace-a') {
        await route.fulfill({ status: 404, json: { message: 'Not found' } });
        return;
      }
      await route.fulfill({ status: 200, json: { ok: true } });
    });
    await page.setContent(`
      <main data-workspace="workspace-a" data-conversation="conversation-a">
        <section aria-label="Mensagens">
          <article data-message="text">Texto sintético</article>
          <article data-message="audio"><audio controls></audio></article>
          <article data-message="image"><img alt="Imagem sintética" /></article>
          <article data-message="outbound" data-status="pending">Teste pendente</article>
        </section>
        <section aria-label="Preview CRM">
          <span data-current>Resumo anterior</span><span> → </span><span data-proposed>Resumo proposto</span>
          <button data-review="analysis">Aprovar análise sem aplicar ações</button>
          <output data-automatic="false">Nenhuma ação automática aplicada</output>
        </section>
        <section aria-label="Ownership" data-state="ai_active">
          <button data-action="handoff">Handoff</button>
          <button data-action="assume">Assumir</button>
          <button data-action="return-ai">Devolver à IA</button>
        </section>
      </main>
    `);
    await page.evaluate(() => {
      const message = document.querySelector('[data-message="outbound"]');
      const state = window as unknown as {
        applyDelivery: (status: string) => void;
        deliveryStatus?: string;
      };
      state.applyDelivery = (status) => {
        if (message instanceof HTMLElement) message.dataset.status = status;
        state.deliveryStatus = status;
      };
      const ownership = document.querySelector('[aria-label="Ownership"]');
      const setOwnership = (selector: string, state: string) => {
        const button = document.querySelector(selector);
        if (
          button instanceof HTMLButtonElement &&
          ownership instanceof HTMLElement
        ) {
          button.onclick = () => {
            ownership.dataset.state = state;
          };
        }
      };
      setOwnership('[data-action="handoff"]', 'handoff_requested');
      setOwnership('[data-action="assume"]', 'human_active');
      setOwnership('[data-action="return-ai"]', 'ai_active');
    });
  });
  afterEach(async () => page.close());

  it('renders canonical media, delivery lifecycle, preview and explicit ownership transitions', async () => {
    await expectStatus(page, 'pending');
    await page.evaluate(() =>
      (
        window as unknown as { applyDelivery: (status: string) => void }
      ).applyDelivery('sent'),
    );
    await expectStatus(page, 'sent');
    await page.evaluate(() =>
      (
        window as unknown as { applyDelivery: (status: string) => void }
      ).applyDelivery('delivered'),
    );
    await expectStatus(page, 'delivered');
    expect(await page.locator('[data-message="text"]').isVisible()).toBe(true);
    expect(await page.locator('[data-message="audio"] audio').count()).toBe(1);
    expect(await page.locator('[data-message="image"] img').count()).toBe(1);
    expect(await page.locator('[data-current]').textContent()).toBe(
      'Resumo anterior',
    );
    expect(await page.locator('[data-proposed]').textContent()).toBe(
      'Resumo proposto',
    );
    expect(
      await page.getByText('Aprovar análise sem aplicar ações').isVisible(),
    ).toBe(true);
    expect(await page.locator('[data-automatic="false"]').isVisible()).toBe(
      true,
    );

    for (const [action, state] of [
      ['handoff', 'handoff_requested'],
      ['assume', 'human_active'],
      ['return-ai', 'ai_active'],
    ] as const) {
      await page.locator(`[data-action="${action}"]`).click();
      expect(
        await page
          .locator('[aria-label="Ownership"]')
          .getAttribute('data-state'),
      ).toBe(state);
    }
  });

  it('preserves delivery after refetch-style render and denies another workspace', async () => {
    await page.evaluate(() =>
      (
        window as unknown as { applyDelivery: (status: string) => void }
      ).applyDelivery('delivered'),
    );
    await page.evaluate(() => {
      const node = document.querySelector(
        '[data-message="outbound"]',
      ) as HTMLElement;
      node.dataset.status =
        (window as unknown as { deliveryStatus?: string }).deliveryStatus ??
        'pending';
    });
    await expectStatus(page, 'delivered');
    const result = await page.evaluate(async () => {
      const response = await fetch('https://inbox.test/ledger', {
        headers: { 'x-workspace-id': 'workspace-b' },
      });
      return response.status;
    });
    expect(result).toBe(404);
    expect(await page.locator('main').getAttribute('data-conversation')).toBe(
      'conversation-a',
    );
  });
});

async function expectStatus(page: Page, status: string) {
  expect(
    await page.locator('[data-message="outbound"]').getAttribute('data-status'),
  ).toBe(status);
}
